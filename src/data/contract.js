/**
 * What a backend has to provide, stated once and checked.
 *
 * The old declaration (types.js) named seven things. The app had come to
 * depend on seven more — watch, commitMany, identity, newAuthorId, isExpert,
 * readFailed, remoteDocs — every one of them consumed by asking whether the
 * method happened to exist: `adapter.watch ? … : …`, `adapter.readFailed?.()`,
 * `!!adapter.loadSync`. That is not an interface. It is a set of guesses
 * spread across the call sites that make them, and it means the real contract
 * is unwritten and a third backend cannot be built from the document that
 * exists to say how.
 *
 * So: one shape, declared here, validated at construction. A backend that does
 * not satisfy it fails loudly when it is built rather than subtly when some
 * caller probes for a method it never had.
 *
 * TWO THINGS ARE DIFFERENT FROM THE OLD SHAPE, and both are the point.
 *
 * **Capabilities are declared, not detected.** A backend says what it can do.
 * Callers ask the capability, never the method. "Does this store push changes"
 * stops being `!!adapter.watch` — an inference that happens to be right today
 * and silently means something else the moment a backend gains a method for
 * another reason.
 *
 * **A read can ask for what changed.** `read(collection, { since })` answers
 * with the documents that changed, the ones that were REMOVED, and a new
 * watermark. Removals are recorded rather than being an absence, because a
 * reader cannot otherwise tell "deleted" from "not in this page". This is the
 * one thing that genuinely cannot be added later: the old interface returns a
 * whole collection and has nowhere to put either a watermark or a deletion, so
 * every consumer above it is written against whole-collection reads and adding
 * deltas afterwards is a rewrite rather than an extension.
 *
 * Documents carry a version from the start. There is nothing to migrate today
 * and that is exactly when it is free; "not needed" is how the current shapes
 * calcified, and this is the second rebuild.
 */

/** The current document shape. Bumped when a stored shape changes meaning. */
export const DOC_VERSION = 1;

/**
 * What a backend can do. Every field is required — a backend states its
 * answer rather than leaving it to be inferred from what it implements.
 *
 * @typedef  {object} Capabilities
 * @property {boolean} push     it tells us when something changes, unasked
 * @property {boolean} sync     it can answer a read without awaiting
 * @property {boolean} refuses  a write can be rejected on authority, not just fail
 * @property {boolean} shared   more than one person reads and writes this data
 */

/**
 * @typedef  {object} ReadResult
 * @property {Record<string, object>} docs    changed since `since`, or all of them
 * @property {string[]} removed               ids that are gone; never an absence
 * @property {string} watermark               pass back as `since` to continue
 * @property {boolean} complete               true when this was a full read
 */

/**
 * One requested change. `doc: null` is a removal.
 *
 * @typedef  {object} Change
 * @property {string} collection
 * @property {string} id
 * @property {object|null} doc
 */

/**
 * What happened to one change. Three outcomes, not two — the missing third is
 * what let a rejected write be displayed as stored, indefinitely.
 *
 * @typedef  {object} ChangeResult
 * @property {string} collection
 * @property {string} id
 * @property {'stored'|'refused'|'unreached'} outcome
 * @property {Error} [error]
 */

/**
 * @typedef  {object} Backend
 * @property {string} name
 * @property {Capabilities} capabilities
 * @property {(collection: string, opts?: {since?: string}) => Promise<ReadResult>} read
 * @property {(changes: Change[]) => Promise<ChangeResult[]>} write
 * @property {(collection: string) => Record<string, object>} [readSync]
 * @property {(collection: string, onChange: Function, onError: Function, opts?: {since?: string}) => Function} [watch]
 * @property {() => string|null} [identity]
 * @property {(taken: Set<string>) => string|null} [newIdentity]
 */

const REQUIRED = ['name', 'capabilities', 'read', 'write'];
const CAPABILITIES = ['push', 'sync', 'refuses', 'shared'];

/**
 * Checks a backend against the contract, and says precisely what is missing.
 *
 * Called when the backend is built, so a mistake surfaces at startup with a
 * name attached rather than as an empty collection three layers up. The cost
 * of the old arrangement was never a crash — it was silence.
 */
export function verifyBackend(backend) {
    const problems = [];
    if (!backend || typeof backend !== 'object') return ['not an object'];

    REQUIRED.forEach((k) => {
        if (backend[k] === undefined) problems.push(`missing ${k}`);
    });
    ['read', 'write'].forEach((k) => {
        if (backend[k] !== undefined && typeof backend[k] !== 'function') {
            problems.push(`${k} is not a function`);
        }
    });

    const caps = backend.capabilities;
    if (caps === undefined) {
        // already reported as missing
    } else if (typeof caps !== 'object' || caps === null) {
        problems.push('capabilities is not an object');
    } else {
        CAPABILITIES.forEach((c) => {
            if (typeof caps[c] !== 'boolean') problems.push(`capabilities.${c} must be declared`);
        });
    }

    // A capability the backend cannot honour is worse than one it does not
    // claim, because callers act on the claim.
    if (caps?.sync && typeof backend.readSync !== 'function') {
        problems.push('claims sync but has no readSync');
    }
    if (caps?.push && typeof backend.watch !== 'function') {
        problems.push('claims push but has no watch');
    }

    return problems;
}

/** Throws unless the backend satisfies the contract. */
export function requireBackend(backend) {
    const problems = verifyBackend(backend);
    if (problems.length) {
        throw new Error(
            `Backend "${backend?.name ?? '(unnamed)'}" does not satisfy the storage contract: `
            + `${problems.join('; ')}. See src/data/contract.js.`,
        );
    }
    return backend;
}

/**
 * Presents an old-style adapter through the new contract.
 *
 * The bridge that lets this land one store at a time instead of as a rewrite
 * of everything that touches storage. An adapter wrapped here answers reads
 * and writes in the new shape while still doing the old thing underneath: a
 * read is always complete, so `since` is accepted and ignored, and the
 * watermark advances on every read because nothing finer is knowable.
 *
 * That is not a delta and does not pretend to be. `capabilities.push`
 * reflects the wrapped adapter honestly, and a caller asking for deltas gets
 * correct answers at full cost until the adapter underneath learns to do
 * better. Correctness first, saving second — the reverse is how a cache ends
 * up serving a page that was never fetched.
 */
export function fromLegacyAdapter(adapter) {
    const capabilities = {
        push: typeof adapter.watch === 'function',
        sync: typeof adapter.loadSync === 'function',
        // Only a store with an authority can refuse. Everything else merely
        // fails, and a failure is retried where a refusal must not be.
        refuses: typeof adapter.isExpert === 'function',
        shared: typeof adapter.watch === 'function',
    };

    const backend = {
        name: adapter.name,
        capabilities,

        async read(collection) {
            const docs = await adapter.load(collection);
            return { docs: docs ?? {}, removed: [], watermark: String(Date.now()), complete: true };
        },

        async write(changes) {
            // Grouped by collection, because the old interface has no
            // cross-collection write and commit() is per collection.
            const byCollection = new Map();
            changes.forEach((c) => {
                if (!byCollection.has(c.collection)) byCollection.set(c.collection, []);
                byCollection.get(c.collection).push(c);
            });

            const results = [];
            for (const [collection, group] of byCollection) {
                try {
                    if (adapter.commit) {
                        await adapter.commit(collection, group.map(({ id, doc }) => ({ id, doc })));
                    } else {
                        for (const { id, doc } of group) {
                            if (doc === null) await adapter.remove(collection, id);
                            else await adapter.set(collection, id, doc);
                        }
                    }
                    group.forEach(c => results.push({ collection, id: c.id, outcome: 'stored' }));
                } catch (error) {
                    // Which of the two this is decides whether it may be
                    // retried, and the old adapters do not say — so the
                    // classification stays where it already lives, above this,
                    // and every failure arrives here as unreached.
                    group.forEach(c => results.push({ collection, id: c.id, outcome: 'unreached', error }));
                }
            }
            return results;
        },
    };

    if (capabilities.sync) backend.readSync = (collection) => adapter.loadSync(collection) ?? {};
    if (capabilities.push) {
        backend.watch = (collection, onChange, onError) => adapter.watch(
            collection,
            docs => onChange({ docs: docs ?? {}, removed: [], watermark: String(Date.now()), complete: true }),
            onError,
        );
    }
    if (adapter.identity) backend.identity = () => adapter.identity();
    if (adapter.newAuthorId) backend.newIdentity = taken => adapter.newAuthorId(taken);

    return requireBackend(backend);
}
