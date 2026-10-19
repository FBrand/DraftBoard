/**
 * Short ids, unique because they are checked rather than because they are long.
 *
 * Eight base36 characters is 2.8e12 values. Generated blind, that is about a
 * one-in-25,000 chance of a collision somewhere among 15,000 players — which
 * sounds small and is not, because a collision here does not glitch, it merges
 * two people. The registry exists to stop exactly that.
 *
 * So they are not generated blind. Every caller mints with the existing ids
 * already in memory — `resolveAll` holds the whole registry, boards and authors
 * and seasons are a handful of records — and a retry against that set drives the
 * local probability to zero. The birthday arithmetic only governs the case this
 * cannot see: two experts writing to Firestore seconds apart, neither aware of
 * the other's new id. Eight characters is the judgement about how much that
 * matters, and the length is the only lever if it turns out to matter more.
 *
 * Failing to be short is fine; failing to be unique is not. After fifty
 * collisions — which would mean the set is enormous or the entropy source is
 * broken — it gives up on eight characters rather than on uniqueness.
 *
 * `crypto.getRandomValues` rather than `randomUUID`: the latter exists only in a
 * secure context, and this app is served over plain HTTP on a LAN address,
 * where it is simply absent. That produced ids of two different shapes from one
 * build depending on how it was reached, silently, for months.
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const LENGTH = 8;

/** The largest multiple of 36 that fits in a byte — above it, resample. */
const CEILING = 252;

function randomBytes(n) {
    const bytes = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
        return bytes;
    }
    // No Web Crypto at all. Genuinely weaker, and reached only where there is
    // nothing better to reach for.
    for (let i = 0; i < n; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
}

/**
 * A base36 string of `length` characters, uniformly distributed.
 *
 * Bytes at or above 252 are discarded rather than taken modulo 36, which would
 * make the first four letters of the alphabet fractionally likelier than the
 * rest. That bias would never be noticed; rejecting is two lines.
 */
export function randomBase36(length = LENGTH) {
    let out = '';
    while (out.length < length) {
        const bytes = randomBytes(length * 2);
        for (let i = 0; i < bytes.length && out.length < length; i += 1) {
            if (bytes[i] >= CEILING) continue;
            out += ALPHABET[bytes[i] % 36];
        }
    }
    return out;
}

/**
 * A new id of the given kind, not already in `taken`.
 *
 * `taken` is a Set of ids — the whole collection this id is joining. Passing
 * nothing is allowed and means generating blind, which is only safe where the
 * set genuinely is not available.
 */
export function shortId(prefix, taken) {
    for (let i = 0; i < 50; i += 1) {
        const id = `${prefix}_${randomBase36(LENGTH)}`;
        if (!taken || !taken.has(id)) return id;
    }
    // Something is badly wrong — an enormous set, or an entropy source
    // returning constants. Length is the thing to give up on.
    return `${prefix}_${randomBase36(LENGTH + 6)}`;
}

/** `p` player, `b` board, `s` season, `a` author. */
export const prefixedId = (prefix, taken) => shortId(prefix, taken);
