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

/**
 * Splits the acquisition suffix off a roster name.
 *
 * roster.csv records how a player arrived inside his own name — "Xavier
 * Worthy:24/1", "Andrew Armstrong:FA", "Omari Evans:UDFA". That put facts
 * inside the identity key: the name is what everything matches on, so
 * "Xavier Worthy" and "Xavier Worthy:24/1" are two different players as far as
 * the matcher is concerned, and one of them is fiction.
 *
 * The file keeps its format — it is the import format, and it is hand-edited.
 * This turns it into facts on the way in, so the app stores the plain name.
 *
 *   "24/1"  drafted in 2024, round 1
 *   "5"     drafted this year, round 5 (the year is implied by the file)
 *   "UDFA"  entered the league undrafted
 *   "FA"    signed from another club — an acquisition, not a league entry
 *   "TR"    acquired by trade
 *
 * Returns `{ name, facts, route }`. `route` is how he got to THIS team, which
 * is not the same question as how he got into the league: a player can be a
 * 2024 second-rounder and still have arrived here as a free agent.
 */
const EARLIER_DRAFT = /^(\d{2})\/(\d+)$/;   // "24/1"
const THIS_DRAFT = /^(\d{1,2})$/;           // "5"

export function parseAcquisition(rawName, thisDraftYear) {
    const text = String(rawName ?? '').trim();
    const at = text.lastIndexOf(':');
    if (at === -1) return { name: text, facts: {}, route: null };

    const name = text.slice(0, at).trim();
    const suffix = text.slice(at + 1).trim();
    if (!name || !suffix) return { name: text, facts: {}, route: null };

    const earlier = suffix.match(EARLIER_DRAFT);
    if (earlier) {
        // Two-digit years: the file is a working document for the current
        // decade, not an archive.
        const year = 2000 + parseInt(earlier[1], 10);
        return { name, facts: { isUdfa: false, draftYear: year, draftRound: parseInt(earlier[2], 10) }, route: 'draft' };
    }

    const thisYear = suffix.match(THIS_DRAFT);
    if (thisYear) {
        return {
            name,
            facts: { isUdfa: false, draftYear: thisDraftYear, draftRound: parseInt(thisYear[1], 10) },
            route: 'draft',
        };
    }

    const upper = suffix.toUpperCase();
    if (upper === 'UDFA') return { name, facts: { isUdfa: true, draftYear: thisDraftYear }, route: 'udfa' };
    if (upper === 'FA') return { name, facts: {}, route: 'fa' };
    if (upper === 'TR') return { name, facts: {}, route: 'trade' };

    // Something the file uses that this doesn't know about: leave the name
    // alone rather than silently truncating it.
    return { name: text, facts: {}, route: null };
}
