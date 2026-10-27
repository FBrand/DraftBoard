import { boardBySlug } from './boardRegistry';
import { loadState as loadBoardState } from './scoutingState';
import { buildNameIndex, findMatchingIndex } from './nameMatcher';
import { rankBoard } from './boardRanking';

/**
 * Resolves the player list ordered by the active scouting board for Draft and UDFA views.
 *
 * Shipped boards (consensus, dan, ryan) carry a rankingsFile: useDraftState already
 * fetched and parsed it, so `players` is already in the right order for those.
 *
 * In-app boards (rankingsFile: null) start with all players unranked. Only players
 * explicitly placed in `entries` receive a round/tier. Those placements are ranked
 * with rankBoard so that `overallRank` (1, 2, 3...) and `positionRank` (QB1, WR1...)
 * are derived correctly according to the analyst's tiers. Players without an entry
 * remain unranked.
 */
export function resolveBoardPlayers(players, boardSlug, {
    getBoard = boardBySlug,
    loadState = loadBoardState,
} = {}) {
    const board = getBoard(boardSlug);
    if (!board || board.rankingsFile) return players;

    const { entries } = loadState(board.id);
    if (!entries?.length) {
        return players.map(p => ({
            ...p,
            round: null,
            tier: null,
            overallRank: null,
            positionRank: null,
        }));
    }

    const byId = new Map(entries.filter(e => e.playerId).map(e => [e.playerId, e]));
    const index = buildNameIndex(entries);

    const entryFor = (name, player) => {
        if (player?.id && byId.has(player.id)) {
            return byId.get(player.id);
        }
        const idx = findMatchingIndex(name, index, player);
        if (idx !== -1) return entries[idx];
        return { cleared: true, round: null, tier: null };
    };

    const basePlayers = players.map(p => ({
        ...p,
        round: null,
        tier: null,
        overallRank: null,
        positionRank: null,
    }));

    return rankBoard(basePlayers, entryFor);
}
