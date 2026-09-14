/**
 * A v4 uuid, on every origin the app is actually served from.
 *
 * `crypto.randomUUID()` is only exposed in a **secure context** — HTTPS, or
 * localhost. This app is routinely served off a LAN address over plain HTTP,
 * and there the method simply does not exist, so every call fell through to a
 * timestamp-plus-random fallback. The result was ids like `p_mu1pj3za48y4e6o7`
 * in production and real uuids in development: the same build producing two
 * different id formats depending on how it was reached, with nothing anywhere
 * saying so.
 *
 * `crypto.getRandomValues()` has no such restriction — it is available over
 * plain HTTP — so the uuid is assembled from it instead, and the answer is the
 * same shape everywhere. The last resort below is `Math.random`, which is
 * genuinely weak, but it is reached only where there is no Web Crypto at all.
 *
 * Existing ids are untouched. An id is permanent — it is what every board
 * entry, evaluation and depth-chart slot points at — so the short ones stay
 * exactly as they are. Only new ones change shape.
 */
const HEX = [];
for (let i = 0; i < 256; i += 1) HEX.push((i + 0x100).toString(16).slice(1));

function randomBytes(n) {
    const bytes = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
        return bytes;
    }
    for (let i = 0; i < n; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
}

/** A canonical v4 uuid: version nibble 4, variant bits 10. */
export function uuid() {
    const b = randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return `${HEX[b[0]]}${HEX[b[1]]}${HEX[b[2]]}${HEX[b[3]]}-${HEX[b[4]]}${HEX[b[5]]}-`
        + `${HEX[b[6]]}${HEX[b[7]]}-${HEX[b[8]]}${HEX[b[9]]}-`
        + `${HEX[b[10]]}${HEX[b[11]]}${HEX[b[12]]}${HEX[b[13]]}${HEX[b[14]]}${HEX[b[15]]}`;
}

/** `p`, `b`, `s`, `a` — what kind of thing this is, then the uuid. */
export const prefixedId = (prefix) => `${prefix}_${uuid()}`;
