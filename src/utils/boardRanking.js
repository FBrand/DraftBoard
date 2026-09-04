/**
 * Derives a board's rankings from its structure instead of storing them as
 * free-floating numbers.
 *
 * The rules, in order:
 *  1. Subgroups are authoritative. A player in group "1.2" always outranks
 *     every player in "1.3", regardless of anything else.
 *  2. Within a group, order by the analyst's explicit choice when there is
 *     one (`withinGroup`, set by dragging or by typing a rank).
 *  3. Failing that, keep the order the loaded rankings already give. A
 *     rankings CSV lists the players inside a tier deliberately, so throwing
 *     that away loses real information — and it would make every untouched
 *     board identical, since none of them have overrides yet.
 *  4. Positional value breaks any remaining tie, so players the source
 *     doesn't separate still come out in a sensible order.
 *
 * Total rank and position rank both fall out of that single ordering, so they
 * can never disagree with each other or with where a card sits on the board.
 */

// Rough positional-value order, most valuable first. A default for breaking
// ties inside a tier, not a claim about any specific player — the analyst
// overrides it by dragging or typing a rank, which sets `withinGroup`.
export const POSITION_VALUE = [
    'QB', 'EDGE', 'OT', 'WR', 'CB', 'DL', 'S', 'TE', 'LB', 'IOL', 'RB', 'FB', 'K', 'P', 'LS',
];

const POSITION_VALUE_INDEX = new Map(POSITION_VALUE.map((p, i) => [p, i]));

/** "WR.Z" -> "WR"; the board's columns are keyed by the base position. */
export function basePosition(position) {
    return String(position ?? '').split('.', 1)[0];
}

export function positionValueIndex(position) {
    const idx = POSITION_VALUE_INDEX.get(basePosition(position));
    return idx === undefined ? POSITION_VALUE.length : idx;
}

/**
 * Sort key for a group label: "1.2" -> [1, 2], "2" -> [2, 0]. Unparseable
 * labels sort last rather than throwing off everything above them.
 */
export function groupKey(group) {
    const m = String(group ?? '').match(/^(\d+)(?:\.(\d+))?/);
    if (!m) return [Number.MAX_SAFE_INTEGER, 0];
    return [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0];
}

export function compareGroups(a, b) {
    const [ra, ta] = groupKey(a);
    const [rb, tb] = groupKey(b);
    return ra - rb || ta - tb || String(a ?? '').localeCompare(String(b ?? ''));
}

/**
 * Applies each player's overrides, orders the board by the rules above, and
 * stamps the derived `overallRank` (total) and `positionRank` onto each
 * player. Returns a new array; never mutates the input.
 *
 * `entryFor(name)` supplies the analyst's overrides for a player:
 * `{ group, withinGroup }` — both optional.
 */
export function rankBoard(players, entryFor) {
    const withOverrides = players.map(p => {
        const e = entryFor(p.name);
        return {
            player: p,
            group: e?.group ?? p.group,
            withinGroup: e?.withinGroup ?? null,
            posValue: positionValueIndex(p.position),
        };
    });

    withOverrides.sort((a, b) => {
        const byGroup = compareGroups(a.group, b.group);
        if (byGroup !== 0) return byGroup;

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

    const perPosition = new Map();
    return withOverrides.map((row, i) => {
        const base = basePosition(row.player.position);
        const nextPosRank = (perPosition.get(base) ?? 0) + 1;
        perPosition.set(base, nextPosRank);
        return {
            ...row.player,
            group: row.group,
            overallRank: i + 1,
            positionRank: nextPosRank,
        };
    });
}

/**
 * Moves `name` to 1-based total rank `targetRank` within an already-ranked
 * board, and returns `{ group, order }` — the group the player lands in, and
 * the resulting full ordering of names.
 *
 * Moving to a slot means landing in that slot's tier: rank 4 -> 2 leaves #1
 * alone, puts the mover at #2, and pushes the old #2 and #3 down to #3 and
 * #4. Nothing from #5 on moves.
 */
export function moveToRank(rankedPlayers, name, targetRank) {
    const order = rankedPlayers.map(p => p.name);
    const from = order.indexOf(name);
    if (from === -1) return null;

    const without = order.filter(n => n !== name);
    const to = Math.max(0, Math.min(without.length, targetRank - 1));
    without.splice(to, 0, name);

    // Adopt the tier of whoever the mover now sits beside, so a rank move can
    // never contradict rule 1 (subgroups are authoritative).
    const neighbour = rankedPlayers.find(p => p.name === (without[to + 1] ?? without[to - 1]));
    const group = neighbour?.group ?? rankedPlayers.find(p => p.name === name)?.group ?? null;

    return { group, order: without };
}
