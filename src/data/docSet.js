/**
 * A list the app hands over whole, stored as documents it writes one at a time.
 *
 * Every store here works the same way: the UI holds a whole stage in memory
 * and saves all of it on every edit. That is a fine thing for a UI to do and a
 * terrible thing to write, because saving the whole of something is how two
 * people editing different parts of it overwrite each other — the later save
 * wins with a copy that never saw the earlier one.
 *
 * So the shape stays and the WRITE changes. Given the list as it now is, this
 * works out which documents actually differ and commits those. One drag is one
 * document. A re-seed is all of them, in one batch. Nothing changed is no
 * write at all, which matters because a React view re-saves on every render
 * that touches state.
 *
 * Extracted from the board-entry store, which did this first and needed it
 * most; roster rows and draft picks have exactly the same problem.
 */
import { repository } from './repository';

/**
 * @param {object}   config
 * @param {string}   config.collection  where the documents live
 * @param {Function} config.idOf        (scope, item) => stable document id
 * @param {Function} [config.scopeOf]   (doc) => the scope a document belongs to
 * @param {Function} [config.strip]     (doc) => the item, minus filing fields
 */
export function createDocSet({ collection, idOf, scopeOf, strip }) {
    const belongsTo = scopeOf ?? ((doc, scope) => doc.scope === scope);

    const mine = (scope) => repository.all(collection).filter(doc => belongsTo(doc, scope));

    const unfile = strip ?? ((doc) => {
        const item = { ...doc };
        delete item.id;
        delete item.scope;
        delete item.order;
        return item;
    });

    return {
        collection,

        /** Everything in this scope, in the order it was written. */
        read(scope) {
            return mine(scope)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map(unfile);
        },

        has(scope) {
            return mine(scope).length > 0;
        },

        /** Writes the list, touching only what differs. Returns the change count. */
        write(scope, items) {
            const current = new Map(mine(scope).map(doc => [doc.id, doc]));
            const changes = [];
            const seen = new Set();

            (items ?? []).forEach((item, order) => {
                const id = idOf(scope, item, order);
                if (seen.has(id)) return; // two of the same thing; the first wins
                seen.add(id);
                const doc = { id, scope, order, ...item };
                const before = current.get(id);
                if (!before || !shallowSame(before, doc)) changes.push({ id, doc });
            });

            current.forEach((_doc, id) => { if (!seen.has(id)) changes.push({ id, doc: null }); });

            if (!changes.length) return 0;
            repository.commit(collection, changes);
            return changes.length;
        },

        /** Drops the whole scope — what scrapping a season does to each stage. */
        removeAll(scope) {
            const ids = mine(scope).map(doc => doc.id);
            if (!ids.length) return Promise.resolve();
            return repository.commit(collection, ids.map(id => ({ id, doc: null })));
        },
    };
}

/**
 * Compared by value, one level deep, with arrays walked.
 *
 * Deliberately not a deep equal: these documents are flat apart from a slot
 * list, and a general deep compare would be slower than the write it is trying
 * to avoid.
 */
export function shallowSame(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        const x = a[k];
        const y = b[k];
        if (x === y) continue;
        if (Array.isArray(x) && Array.isArray(y)) {
            if (x.length !== y.length) return false;
            for (let i = 0; i < x.length; i += 1) {
                const p = x[i];
                const q = y[i];
                if (p === q) continue;
                if (p && q && typeof p === 'object' && typeof q === 'object') {
                    if (!shallowSame(p, q)) return false;
                    continue;
                }
                if ((p ?? null) !== (q ?? null)) return false;
            }
            continue;
        }
        if (x && y && typeof x === 'object' && typeof y === 'object') {
            if (!shallowSame(x, y)) return false;
            continue;
        }
        if ((x ?? null) !== (y ?? null)) return false;
    }
    return true;
}
