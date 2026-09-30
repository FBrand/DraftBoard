/**
 * How much room the local copy is using, measured rather than assumed.
 *
 * localStorage is about 5 MB in every browser that matters, and this app is not
 * far from it. The figures that drove the plan were arithmetic — a remark
 * document's size times a player count times an author count — and arithmetic is
 * how the last two estimates here went wrong in the same direction (a
 * three-expert number reused for ten). So this measures what is actually
 * stored, and the tests measure a synthetic season with it rather than trusting
 * a multiplication.
 *
 * The binding constraint is INTRA-season: at ten experts one season is larger
 * than the whole budget, which no inter-season mechanism can help with. Dropping
 * the oldest season cannot save a season that does not fit.
 *
 * Two builds, two answers, and one rule that is the same for both — measure
 * before deciding:
 *
 *   **Shared build** — the local copy is a cache. Anything in it can be fetched
 *   again, so discarding is free and the only question is what to discard first.
 *
 *   **Local build** — the local copy IS the data. A discarded season is a lost
 *   season, so nothing goes without an export first.
 *
 * Which build is running is not the question that decides it, though. `SPEC.md`
 * §7 has a whole session exported and restored as a file, so a local build can
 * import a ten-author season and land in exactly the volume it is said never to
 * hold. What was imported decides, which is why this measures.
 */

/** What a browser gives us, near enough. Quoted in UTF-16 code units. */
export const BUDGET = 5 * 1024 * 1024;

/** Where this app's data lives. Everything else in localStorage is settings. */
const DATA_PREFIX = 'db_';

/**
 * Bytes per stored key, plus a total.
 *
 * Counts the key as well as the value: 700 player documents at one key each is
 * not free, and the keys here carry a path. Two bytes per UTF-16 code unit,
 * which is what a browser actually charges.
 */
export function measure(storage = globalThis.localStorage) {
    const byKey = {};
    let total = 0;
    let data = 0;

    try {
        for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            const size = ((key?.length ?? 0) + (storage.getItem(key)?.length ?? 0)) * 2;
            byKey[key] = size;
            total += size;
            if (key?.startsWith(DATA_PREFIX)) data += size;
        }
    } catch {
        return { byKey: {}, total: 0, data: 0, budget: BUDGET, pressure: 0 };
    }

    return { byKey, total, data, budget: BUDGET, pressure: total / BUDGET };
}

/** The largest stored keys first — what to look at when the budget is tight. */
export function biggest(limit = 10, storage = globalThis.localStorage) {
    const { byKey } = measure(storage);
    return Object.entries(byKey)
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit)
        .map(([key, bytes]) => ({ key, bytes }));
}

/**
 * What a collection costs, by path rather than by storage key.
 *
 * `db_evaluations/p_1/remarks` is one key per player, so the interesting number
 * is the family: every remark collection together, against every board's
 * entries together. Grouped on the first path segment, which is what a caller
 * deciding what to drop actually thinks in.
 */
export function byCollection(storage = globalThis.localStorage) {
    const { byKey } = measure(storage);
    const out = {};
    Object.entries(byKey).forEach(([key, bytes]) => {
        if (!key.startsWith(DATA_PREFIX)) return;
        const path = key.slice(DATA_PREFIX.length);
        const family = path.split('/')[0];
        out[family] = (out[family] ?? 0) + bytes;
    });
    return out;
}

/** A size a person can read, for a dialog that has to say how much. */
export const human = (bytes) => (bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${Math.round(bytes / 1024)} KB`);

/**
 * Weighs documents directly, the way localAdapter would store them.
 *
 * `measure()` reads localStorage, which is the truth in a browser and empty
 * everywhere else — the unit suite runs on the memory adapter, whose documents
 * live in a Map. Anything that wants a figure for a SHAPE rather than for a
 * particular browser weighs the documents, with the same one-key-per-collection
 * serialisation the local adapter uses, so the number means the same thing.
 *
 * @param {Record<string, Record<string, object>>} dump  paths to their documents
 */
export function measureDump(dump) {
    const byKey = {};
    let total = 0;

    Object.entries(dump ?? {}).forEach(([path, docs]) => {
        const key = `${DATA_PREFIX}${path}`;
        const size = (key.length + JSON.stringify(docs ?? {}).length) * 2;
        byKey[key] = size;
        total += size;
    });

    return { byKey, total, data: total, budget: BUDGET, pressure: total / BUDGET };
}

/** Families, from a dump rather than from localStorage. See byCollection. */
export function familiesOf(dump) {
    const out = {};
    Object.entries(measureDump(dump).byKey).forEach(([key, bytes]) => {
        const family = key.slice(DATA_PREFIX.length).split('/')[0];
        out[family] = (out[family] ?? 0) + bytes;
    });
    return out;
}

// ---------------------------------------------------------------------------
// Making room
// ---------------------------------------------------------------------------

/**
 * What the two builds may discard, which is not the same list.
 *
 * On a SHARED backend the local copy is a cache: remarks, entries and charts can
 * all be fetched again, so dropping them costs a round trip and nothing else.
 *
 * On a LOCAL build the local copy IS the data. Dropping a remark loses it. So
 * nothing here is evictable, and the only honest way to make room is for
 * somebody to export a season and then remove it deliberately.
 *
 * Which build is running does not decide it on its own. `SPEC.md` §7 has a whole
 * session exported and restored as a file, so a local build can be holding a
 * ten-author season that it did not write — the volume it is said never to
 * reach. `canRefetch` is therefore asked of the store, not inferred.
 */
export const EVICTABLE = ['evaluations', 'boards', 'players'];

/**
 * Whether making room is safe at all, and what it would take otherwise.
 *
 * Deliberately returns a REASON rather than a boolean. The caller is a dialog
 * that has to tell somebody why his roster is about to stop saving, and "cannot
 * evict" with no explanation is the kind of message people learn to ignore.
 */
export function evictionPlan({ canRefetch, exportedAt = null, assumeFull = false, storage = globalThis.localStorage } = {}) {
    const { total, budget, pressure } = measure(storage);
    // `assumeFull` is for a caller holding a quota error, and it overrides the
    // measurement because it is better evidence. measure() sees only this app's
    // keys, the quota is shared with everything else on the origin, and the
    // limit itself varies by browser — so a store the browser has just refused
    // to write can measure comfortably under budget. It did: wired to a real
    // quota failure, this answered "There is room."
    const tight = assumeFull || pressure > 0.8;

    if (!tight) {
        return { needed: false, safe: true, reason: 'There is room.', total, budget };
    }

    if (canRefetch) {
        const families = byCollection(storage);
        const order = EVICTABLE
            .map(family => ({ family, bytes: families[family] ?? 0 }))
            .filter(f => f.bytes > 0)
            .sort((a, b) => b.bytes - a.bytes);
        return {
            needed: true,
            safe: true,
            reason: 'The shared store has all of this; the local copy is a cache.',
            drop: order,
            frees: order.reduce((sum, f) => sum + f.bytes, 0),
            total,
            budget,
        };
    }

    // The local build, and the honest answer: nothing can go.
    return {
        needed: true,
        safe: false,
        reason: exportedAt
            ? `Everything here is the only copy. Save your work to a file — the last export was ${exportedAt} — then remove a season deliberately.`
            : 'Everything here is the only copy, and nothing has been exported. Save your work to a file, then clear old seasons.',
        exportedAt,
        total,
        budget,
    };
}
