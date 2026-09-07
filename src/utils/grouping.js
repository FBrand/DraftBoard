/**
 * Splitting a board into collapsible groups.
 *
 * The board grid answers "where does this class sit" — position columns by
 * round. It is the right shape while you are placing players and the wrong one
 * while you are reading, because it has a cell for every intersection whether
 * or not anybody is in it. A list groups only where there is something to
 * group, so a class with four safeties shows four safeties rather than a
 * column of empty boxes.
 *
 * Each grouping leaves somebody out, and that is information rather than a
 * defect: grouped by school, the players with no school recorded; by round,
 * the ones nobody has ranked; by position, the ones nobody has labelled. Those
 * go to `unmatched` rather than into a group called "" — they are exactly the
 * players whose data needs fixing, so they are worth a place of their own.
 */
import { basePosition, tierLabel } from './boardRanking';

export const GROUPINGS = [
    { id: 'position', label: 'Position' },
    { id: 'school', label: 'School' },
    { id: 'round', label: 'Round' },
];

/** The value a player is grouped under, or null when he has none. */
function keyFor(player, groupBy) {
    if (groupBy === 'school') return String(player?.school ?? '').trim() || null;
    if (groupBy === 'round') return player?.round == null ? null : String(player.round);
    const pos = basePosition(player?.position);
    return pos || null;
}

function labelFor(key, groupBy) {
    if (groupBy === 'round') return `Round ${key}`;
    return key;
}

/**
 * Groups in a deliberate order: by round it is numeric, since round 2 comes
 * after round 1 and not after round 10; otherwise the group holding the
 * best-ranked player comes first, so the list opens on what matters rather
 * than on whoever happens to sort alphabetically first.
 *
 * `players` is expected in rank order — that is what the board hands out — and
 * each group keeps that order internally.
 */
export function groupPlayers(players, groupBy = 'position') {
    const groups = new Map();
    const unmatched = [];

    (players ?? []).forEach(p => {
        if (!p?.name) return;
        const key = keyFor(p, groupBy);
        if (key === null) { unmatched.push(p); return; }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
    });

    const out = [...groups.entries()].map(([key, list]) => ({
        key,
        label: labelFor(key, groupBy),
        players: list,
        // Where this group's best player sits overall — both the sort key and
        // something worth showing on the header.
        bestRank: list.reduce(
            (best, p) => (p.overallRank != null && (best == null || p.overallRank < best) ? p.overallRank : best),
            null,
        ),
    }));

    out.sort((a, b) => {
        if (groupBy === 'round') return Number(a.key) - Number(b.key);
        if (a.bestRank == null && b.bestRank == null) return a.label.localeCompare(b.label);
        if (a.bestRank == null) return 1;
        if (b.bestRank == null) return -1;
        return a.bestRank - b.bestRank;
    });

    return { groups: out, unmatched };
}

/** Why a player could not be grouped — shown beside him in the unmatched list. */
export function missingFor(player) {
    const gaps = [];
    if (!String(player?.school ?? '').trim()) gaps.push('school');
    if (player?.round == null) gaps.push('rank');
    if (!basePosition(player?.position)) gaps.push('position');
    return gaps;
}

/** The player's placement as the board writes it — "1.2", or nothing. */
export const placementLabel = (player) => tierLabel(player?.round, player?.tier);
