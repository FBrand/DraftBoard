import { describe, it, expect, beforeEach } from 'vitest';
import {
    getInitMode, shouldSeed, setInitMode, resetTo, INIT_SEEDED, INIT_CLEAN,
} from '../../src/utils/appInit';
import { loadState, saveState, makeEntry } from '../../src/utils/scoutingState';
import { openBoards, allBoards } from '../../src/utils/boardRegistry';
import { isDraftComplete, isUndraftedSigning, isDraftPick } from '../../src/utils/draftPhase';
import { repository } from '../../src/data/repository';

/**
 * Two things the browser suite used to prove by reloading the whole app:
 * which way it comes back up after a wipe (`init-modes.spec.js`), and that one
 * analyst's board is not another's (`scouting.spec.js`, `undo.spec.js`).
 */
beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openBoards();
});

describe('which way the app comes back up', () => {
    it('seeds from the shipped files by default', () => {
        expect(getInitMode()).toBe(INIT_SEEDED);
        expect(shouldSeed()).toBe(true);
    });

    it('comes up empty after a clean slate, and stays that way', () => {
        setInitMode(INIT_CLEAN);
        expect(getInitMode()).toBe(INIT_CLEAN);
        expect(shouldSeed()).toBe(false);
    });

    it('treats anything it does not recognise as seeded rather than empty', () => {
        localStorage.setItem('draftboard_init_mode', 'nonsense');
        expect(getInitMode()).toBe(INIT_SEEDED);
    });
});

describe('wiping', () => {
    const stageKeys = ['rosterState', 'fa_state_v1', 'nfl_draft_board_state', 'db_players'];

    it('clears every stage, not just the ones a literal list could name', () => {
        stageKeys.forEach(k => localStorage.setItem(k, '{"x":1}'));
        const board = allBoards()[0];
        saveState(board.id, { version: 1, entries: [makeEntry('Arvell Reese', 'EDGE')] });

        resetTo(INIT_CLEAN);

        stageKeys.forEach(k => expect(localStorage.getItem(k), k).toBeNull());
        // The boards are the ones that got left behind before, because their
        // key contains a board id and no fixed list can spell it.
        expect(localStorage.getItem(`scouting_board_v1__${board.id}`)).toBeNull();
    });

    it('keeps the init mode itself, which is what the reload reads', () => {
        resetTo(INIT_CLEAN);
        expect(getInitMode()).toBe(INIT_CLEAN);

        resetTo(INIT_SEEDED);
        expect(getInitMode()).toBe(INIT_SEEDED);
    });

    it('empties the repository’s memory too, not only the keys under it', () => {
        // Clearing storage alone left the in-memory copy intact, so the wiped
        // collections came straight back on the next read.
        expect(allBoards().length).toBeGreaterThan(0);
        resetTo(INIT_CLEAN);
        expect(repository.all('boards')).toEqual([]);
    });
});

describe('one analyst’s board is not another’s', () => {
    it('stores each board under its own key', () => {
        const [a, b] = allBoards();
        saveState(a.id, { version: 1, entries: [makeEntry('Arvell Reese', 'EDGE')] });

        expect(loadState(a.id).entries).toHaveLength(1);
        expect(loadState(b.id).entries).toHaveLength(0);
    });

    it('gives a board nobody has touched an empty state rather than somebody else’s', () => {
        const board = allBoards()[0];
        expect(loadState(board.id)).toEqual({ version: 1, entries: [] });
    });

    it('moves work written under the old name-based key onto the board', () => {
        // Boards used to be keyed by the analyst's slug, so a rename stranded
        // the work. It is read once under the old key and rewritten under the
        // new one.
        const board = allBoards().find(b => b.authorId);
        const legacy = { version: 1, entries: [makeEntry('Fernando Mendoza', 'QB')] };
        localStorage.setItem(`scouting_overlay_v1__${board.slug}`, JSON.stringify(legacy));

        expect(loadState(board.id).entries).toHaveLength(1);
        // And it has moved, not been copied — the old key is gone.
        expect(localStorage.getItem(`scouting_overlay_v1__${board.slug}`)).toBeNull();
        expect(localStorage.getItem(`scouting_board_v1__${board.id}`)).toBeTruthy();
    });
});

describe('when UDFA signing opens', () => {
    // The gate is the pick counter, not a flag somebody sets: a signing is
    // undrafted if it happens after the last pick of the seventh round.
    it('is shut while picks remain', () => {
        expect(isDraftComplete(100)).toBe(false);
        expect(isDraftComplete(257)).toBe(false); // the last pick is still a pick
    });

    it('is open once the last pick has been made', () => {
        expect(isDraftComplete(258)).toBe(true);
    });

    it('counts a labelled signing as undrafted and a numbered one as a pick', () => {
        expect(isUndraftedSigning({ pickNumber: 'UDFA' })).toBe(true);
        expect(isUndraftedSigning({ pickNumber: 300 })).toBe(true);
        expect(isUndraftedSigning({ pickNumber: 21 })).toBe(false);
        expect(isDraftPick({ pickNumber: 21 })).toBe(true);
        expect(isDraftPick({ pickNumber: 'UDFA' })).toBe(false);
    });

    it('says nothing about a player who has not been taken at all', () => {
        expect(isUndraftedSigning({ pickNumber: null })).toBe(false);
        expect(isUndraftedSigning({})).toBe(false);
    });
});
