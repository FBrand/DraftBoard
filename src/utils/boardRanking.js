import { getPositionValue } from './appSettings';

/**
 * Derives a board's rankings from its structure instead of storing them as
 * free-floating numbers.
 *
 * The rules, in order:
 *  1. Tiers are authoritative. A player in round 1 tier 2 always outranks
 *     every player in round 1 tier 3, regardless of anything else.
 *  2. Within a tier, order by the analyst's explicit choice when there is
 *     one (`withinGroup`, set by dragging or by typing a rank).
 *  3. Failing that, keep the order the loaded rankings already give. A
 *     rankings CSV lists the players inside a tier deliberately, so throwing
 *     that away loses real information — and it would make every untouched
 *     board identical, since none of them have overrides yet.
 *  4. Positional value breaks any remaining tie, so players the source
 *     doesn't separate still come out in a sensible order.
 *
 * The ordering itself IS stored — `withinGroup` is each player's place inside
 * his tier. What is not stored is the global rank number, which is counted off
 * that ordering on read. That is the point: a stored total rank could drift
 * out of step with the tiers, and two players could end up sharing one.
 */

// Positional value breaks ties inside a tier — it decides the order of players
// nobody has explicitly placed. That is an opinion, so it is configurable
// rather than hardcoded (see utils/appSettings.js); it used to be a fixed list
// here, quietly shaping every board. An analyst overrides it for any given
// player by dragging or typing a rank, which sets `withinGroup`.
export { DEFAULT_POSITION_VALUE as POSITION_VALUE } from './appSettings';

function positionValueIndexMap() {
    const order = getPositionValue();
    return { map: new Map(order.map((p, i) => [p, i])), size: order.length };
}

/** "WR.Z" -> "WR"; the board's columns are keyed by the base position. */
export function basePosition(position) {
    return String(position ?? '').split('.', 1)[0];
}

export function positionValueIndex(position) {
    const { map, size } = positionValueIndexMap();
    const idx = map.get(basePosition(position));
    return idx === undefined ? size : idx;
}

/**
 * A player's place on a board is a round and a tier: two numbers, stored as
 * two numbers. They were once fused into a single "1.3" string because that is
 * the form rankings.csv uses — which meant every read parsed a string to get
 * at values the app had itself just formatted.
 *
 * The joined form now exists only at the CSV boundary, where the file format
 * requires it: parseTier on the way in, tierLabel on the way out.
 */
export function parseTier(label) {
    const m = String(label ?? '').match(/^(\d+)(?:\.(\d+))?/);
    if (!m) return { round: null, tier: null };
    return { round: parseInt(m[1], 10), tier: m[2] ? parseInt(m[2], 10) : null };
}

/** "1.3", or "1" for a round with no tier, or '' when unplaced. */
export function tierLabel(round, tier) {
    if (round == null) return '';
    return tier == null ? String(round) : `${round}.${tier}`;
}

/** A stable key for grouping and for React lists. Unplaced players share one. */
export function tierKey(round, tier) {
    return round == null ? 'unranked' : tierLabel(round, tier);
}

const UNPLACED = Number.MAX_SAFE_INTEGER;

/** Round then tier, with unplaced players last. */
export function compareTiers(a, b) {
    const ra = a?.round ?? UNPLACED;
    const rb = b?.round ?? UNPLACED;
    return ra - rb || (a?.tier ?? 0) - (b?.tier ?? 0);
}

/**
 * Applies each player's overrides, orders the board by the rules above, and
 * stamps the derived `overallRank` (total) and `positionRank` onto each
 * player. Returns a new array; never mutates the input.
 *
 * `entryFor(name, player)` supplies the analyst's overrides for a player. The
 * player is passed alongside the name because a name alone is not an identity:
 * two players can share one as long as their position or school differs.
 * `{ round, tier, withinGroup }` — all optional.
 */
export function rankBoard(players, entryFor) {
    const { map: posValues, size: posCount } = positionValueIndexMap();
    const valueOf = (position) => {
        const idx = posValues.get(basePosition(position));
        return idx === undefined ? posCount : idx;
    };

    const withOverrides = players.map(p => {
        const e = entryFor(p.name, p);
        // An entry places a player only if it says where; a null round means
        // this analyst hasn't placed him, not that he has been unplaced.
        const placed = e?.round != null ? e : p;
        return {
            player: p,
            round: placed?.round ?? null,
            tier: placed?.tier ?? null,
            withinGroup: e?.withinGroup ?? null,
            posValue: valueOf(p.position),
        };
    });

    withOverrides.sort((a, b) => {
        const byTier = compareTiers(a, b);
        if (byTier !== 0) return byTier;

        // An explicit choice always beats the positional-value default, and
        // sorts above players in the tier that have no explicit choice.
        const aSet = a.withinGroup != null;
        const bSet = b.withinGroup != null;
        if (aSet && bSet) return a.withinGroup - b.withinGroup;
        if (aSet !== bSet) return aSet ? -1 : 1;

        // The source's own order inside the tier, then positional value for
        // anyone it leaves tied.
        return (a.player.overallRank ?? Infinity) - (b.player.overallRank ?? Infinity)
            || a.posValue - b.posValue
            || String(a.player.name).localeCompare(String(b.player.name));
    });

    // An unranked player has no rank — not "the worst rank". Nobody has placed
    // him in a tier, so numbering him last would assert a judgement no analyst
    // made, and would move every other player's number the moment a name was
    // jotted down mid-game. He sorts to the bottom of the list and his ranks
    // read as unknown until someone tiers him.
    const perPosition = new Map();
    let ranked = 0;
    return withOverrides.map(row => {
        if (row.round == null) {
            return {
                ...row.player,
                round: null, tier: null, withinGroup: row.withinGroup,
                overallRank: null, positionRank: null,
            };
        }
        const base = basePosition(row.player.position);
        const nextPosRank = (perPosition.get(base) ?? 0) + 1;
        perPosition.set(base, nextPosRank);
        ranked += 1;
        return {
            ...row.player,
            round: row.round,
            tier: row.tier,
            // Carried through so a move can take the midpoint between two
            // neighbours without re-reading the stored entries.
            withinGroup: row.withinGroup,
            overallRank: ranked,
            positionRank: nextPosRank,
        };
    });
}

/**
 * Where a player should sit to land at 1-based total rank `targetRank`.
 *
 * Returns a placement for THAT PLAYER ONLY — `{ round, tier, withinGroup }` —
 * not a new ordering for the board. Nobody else moves, and nobody else is
 * written.
 *
 * `withinGroup` is a float, and that is the point. Landing between two
 * players means taking the midpoint of their values, so a move is one number
 * on one player rather than a renumbering of everyone below him. Moving a
 * seventh-rounder used to rewrite all 328 entries; it now writes one.
 *
 * The player adopts the tier of whoever he lands beside, so a rank move can
 * never contradict rule 1 (tiers are authoritative).
 */
export function moveToRank(rankedPlayers, name, targetRank) {
    const order = rankedPlayers.filter(p => p.name !== name);
    if (order.length === rankedPlayers.length) return null;

    const to = Math.max(0, Math.min(order.length, targetRank - 1));
    const before = order[to - 1] ?? null;   // the player he lands behind
    const after = order[to] ?? null;        // the player he lands in front of

    // The tier he joins is the one on the side he is nearer: landing directly
    // behind someone puts him in that player's tier.
    const host = before ?? after;
    if (!host) return null;
    const round = host.round ?? null;
    const tier = host.tier ?? null;

    return { round, tier, withinGroup: between(before, after, round, tier) };
}

const SPACING = 1;

/**
 * A sort value strictly between two neighbours in the same tier.
 *
 * Only neighbours actually IN the destination tier constrain the answer — a
 * player from the tier above says nothing about where this one belongs within
 * this one.
 */
export function between(before, after, round, tier) {
    const inTier = (p) => p && p.round === round && p.tier === tier && p.withinGroup != null;
    const lo = inTier(before) ? before.withinGroup : null;
    const hi = inTier(after) ? after.withinGroup : null;

    if (lo != null && hi != null) return (lo + hi) / 2;
    if (lo != null) return lo + SPACING;
    if (hi != null) return hi - SPACING;
    return SPACING;
}

/**
 * Spacing for a whole tier laid out in order — used when a board is first
 * seeded from a rankings file, and when a tier is renormalised after enough
 * midpoint insertions to have eaten into float precision.
 */
export function spaceEvenly(index) {
    return (index + 1) * SPACING;
}
