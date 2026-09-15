/**
 * The experts' work, read from the shared store; your own, kept in your browser.
 *
 * This is the adapter that makes the two kinds of user work, and the shape is
 * the whole answer to a question that looked awkward: a viewer must be able to
 * build his own board, reorder his own roster and run his own mock, while
 * having no write access at all to the database those things live in.
 *
 * The resolution is that he does not write to it. He writes *over* it.
 *
 *   **Reading** merges the remote collection with a local one, and the local
 *   document wins. A viewer who moves a player writes one small document into
 *   his own browser; the next read hands back the expert's board with that one
 *   placement replaced.
 *
 *   **Writing** goes to exactly one of the two, decided by who is signed in.
 *   An expert writes remote, because his board is the published thing. Anybody
 *   else writes local, always, and the database is never asked — so the
 *   permission error that would otherwise arrive on every keystroke never
 *   happens. The rules still refuse him; this means he never gets refused.
 *
 * Two consequences worth stating, because they are features rather than gaps:
 *
 *   A viewer's own boards are ordinary documents in the same collections, and
 *   are simply absent from everybody else's copy. "Create a local ranking" is
 *   not a separate mode, it is the general case with nothing underneath it.
 *
 *   Deleting is not writing a blank. A viewer removing a player from a board
 *   he does not own cannot delete the remote document, so a TOMBSTONE is
 *   written locally instead and the merge drops it on the way out. Without it,
 *   deletion would silently do nothing — the remote document would come
 *   straight back on the next read, which is the most confusing possible
 *   outcome.
 *
 * What is deliberately NOT here is reconciliation: when an expert edits a
 * board a viewer has already overlaid, the viewer keeps his own version of the
 * documents he touched and gets the expert's for everything else. Whether that
 * is right — and what "take the expert's version back" should look like — is
 * an open question the user has parked, and guessing at it in here would bury
 * the decision in a merge function.
 */

/** A locally-deleted document. The merge drops these; nothing else sees them. */
const TOMBSTONE = '__deleted';

export function isTombstone(doc) {
    return !!doc && doc[TOMBSTONE] === true;
}

export function tombstone() {
    return { [TOMBSTONE]: true };
}

/**
 * @param {object}   config
 * @param {object}   config.remote          the shared store — Firestore
 * @param {object}   config.local           this browser — localAdapter
 * @param {Function} config.writesRemote    () => boolean, asked on every write
 * @param {Function} [config.onRemoteError] (path, err) => void
 */
export function createOverlayAdapter({ remote, local, writesRemote, onRemoteError }) {
    const canWriteRemote = writesRemote ?? (() => false);

    /**
     * The local half is where a viewer's work lives, so losing it is losing
     * his session. A remote read failing is different in kind: it means the
     * shared boards are unavailable, which is bad but is not HIS data, and the
     * app is more useful showing his own work than showing nothing.
     */
    /**
     * Paths the shared store could not answer on the last attempt.
     *
     * Degrading to the local overlay is right for RENDERING — see above. It is
     * wrong for deciding, and one caller decides: `openBoards()` reads "no
     * boards" as "nobody has ever made one" and seeds a season. A read that
     * failed and a collection that is genuinely empty are the same `{}` to it,
     * so a Firestore outage, a lapsed config or a bad connection at the wrong
     * moment would have every viewer quietly seed a private board over the
     * shared one and keep it. This is how that caller tells the two apart.
     */
    const failedPaths = new Set();

    async function remoteDocs(path) {
        try {
            const docs = await remote.load(path);
            failedPaths.delete(path);
            return docs;
        } catch (err) {
            failedPaths.add(path);
            onRemoteError?.(path, err);
            return {};
        }
    }

    const localDocs = (path) => (
        local.loadSync ? local.loadSync(path) : local.load(path)
    );

    /** The shared documents with this browser own documents laid over the top. */
    function overlaid(theirs, mine) {
        const merged = { ...(theirs ?? {}) };
        Object.entries(mine ?? {}).forEach(([id, doc]) => {
            // A tombstone removes; anything else replaces.
            if (isTombstone(doc)) delete merged[id];
            else merged[id] = doc;
        });
        return merged;
    }

    return {
        name: 'overlay',

        /** Whether the last read of this path reached the shared store. */
        readFailed: (path) => failedPaths.has(path),

        /**
         * No loadSync, even though the local half has one.
         *
         * Offering it would answer with only the local overlay — which for a
         * viewer who has changed nothing is an empty board, returned instantly
         * and confidently. That is worse than not answering. Its absence is
         * what forces callers onto ready(), same as the memory adapter.
         */

        async load(path) {
            const [mine, theirs] = await Promise.all([
                Promise.resolve(localDocs(path)),
                remoteDocs(path),
            ]);
            return overlaid(theirs, mine);
        },

        /**
         * The shared collection, re-reported whenever it changes, with this
         * browser own work still on top.
         *
         * Only the remote half is watched. A local change does not need to
         * arrive this way — it went through the repository, which already
         * showed it — and watching both would deliver it twice.
         *
         * The overlay is re-applied on every update rather than once at the
         * start: a viewer who has tagged a player keeps his tag when the expert
         * moves that same player, or following a board would quietly overwrite
         * the work he is keeping alongside it.
         */
        watch: remote.watch
            ? (path, onDocs, onError) => remote.watch(
                path,
                (theirs) => onDocs(overlaid(theirs, localDocs(path))),
                onError,
            )
            : undefined,

        async set(path, id, doc) {
            if (canWriteRemote()) return remote.set(path, id, doc);
            return local.set(path, id, doc);
        },

        async remove(path, id) {
            if (canWriteRemote()) return remote.remove(path, id);
            // Locally only: a blank would be a document, and dropping the
            // local copy would let the remote one come back.
            return local.set(path, id, tombstone());
        },

        async commit(path, changes) {
            if (canWriteRemote()) {
                return remote.commit
                    ? remote.commit(path, changes)
                    : Promise.all(changes.map(c => (c.doc === null
                        ? remote.remove(path, c.id)
                        : remote.set(path, c.id, c.doc))));
            }
            const localised = changes.map(c => (
                c.doc === null ? { id: c.id, doc: tombstone() } : c
            ));
            return local.commit
                ? local.commit(path, localised)
                : Promise.all(localised.map(c => local.set(path, c.id, c.doc)));
        },

        /**
         * Clearing drops YOUR copy, not theirs.
         *
         * For a viewer this is "start my mock again", and it must leave the
         * experts' boards exactly where they are — so it wipes the overlay and
         * the next read shows the shared state again. Tombstones go with it,
         * which is right: a clean slate should not remember what you had
         * deleted.
         */
        async clear(path) {
            if (canWriteRemote() && remote.clear) return remote.clear(path);
            return local.clear ? local.clear(path) : undefined;
        },
    };
}
