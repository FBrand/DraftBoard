/**
 * What phase of the draft a pick belongs to.
 *
 * A pick number is NOT always a number. `DraftBoard_Picks.csv` records
 * undrafted signings with the literal `UDFA` in the pick column, and the app
 * keeps it that way on purpose — the card prints "UDFA" where a drafted player
 * prints "PK 41", which is exactly what an analyst wants to see.
 *
 * That makes arithmetic on `pickNumber` a trap, and it sprang: seeding the
 * current pick did `Math.max(max, p.pickNumber)` over every signing, one
 * `Math.max(257, "UDFA")` returned NaN, NaN swallowed every later value, and
 * `currentPick` came out NaN. `(NaN || 1) > 257` is false, so a fully
 * completed draft with hundreds of UDFAs signed reported as not yet started
 * and the UDFA panel stayed locked. The same `(p.pickNumber || 0) > 257`
 * comparison silently counted zero UDFAs everywhere else.
 *
 * So: nothing outside this module compares a raw `pickNumber` against a
 * number.
 */

/** The last pick of a seven-round draft. Anything after it is a signing. */
export const LAST_DRAFT_PICK = 257;

/** A pick's numeric value, or null when it isn't one (a `UDFA` label). */
export function pickNumberOf(player) {
    const n = Number(player?.pickNumber);
    return Number.isFinite(n) ? n : null;
}

/**
 * True for an undrafted signing: either a pick past the end of the draft, or
 * a non-numeric label, which only UDFA rows carry.
 */
export function isUndraftedSigning(player) {
    if (player?.pickNumber == null || player.pickNumber === '') return false;
    const n = pickNumberOf(player);
    return n === null || n > LAST_DRAFT_PICK;
}

/** True for a real draft selection — rounds one through seven. */
export function isDraftPick(player) {
    const n = pickNumberOf(player);
    return n !== null && n > 0 && n <= LAST_DRAFT_PICK;
}

/** The draft is over once the pick counter has passed the final selection. */
export function isDraftComplete(currentPick) {
    const n = Number(currentPick);
    return Number.isFinite(n) && n > LAST_DRAFT_PICK;
}

/**
 * The highest real pick recorded, ignoring UDFA labels. Used to seed the pick
 * counter when the app comes up from a saved draft.
 */
export function highestDraftPick(players) {
    return (players ?? []).reduce((max, p) => {
        const n = pickNumberOf(p);
        return n !== null ? Math.max(max, n) : max;
    }, 0);
}
