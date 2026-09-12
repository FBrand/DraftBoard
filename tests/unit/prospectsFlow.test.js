import { describe, it, expect, beforeEach } from 'vitest';
import {
    classify, addProspect, savePlayerEdit, deletePlayer,
    restorePlayer, hiddenPlayers, applyProspects, loadProspects,
} from '../../src/utils/prospects';

/**
 * Adding, correcting and removing players.
 *
 * Replaces the logic half of `add-prospects.spec.js`: the duplicate guard ("a
 * name already on the board blocks the submit until resolved", "the same name
 * at the same position is still blocked", "two players can share a name at
 * different positions"), correction following the board entry, and removal
 * sticking ("a player can be removed, and stays removed").
 *
 * The distinction that runs through all of it: a player from a rankings file
 * is not ours to rewrite — the file is re-read on every load — so a correction
 * is stored as an override and a removal as a hide. A player added in the app
 * is ours, and is edited and deleted in place.
 */
const FILE = [
    { name: 'Fernando Mendoza', position: 'QB', school: 'Indiana' },
    { name: 'Arvell Reese', position: 'EDGE', school: 'Ohio State' },
];

beforeEach(() => { globalThis.resetStorage(); });

describe('deciding whether a typed name is new', () => {
    it('calls an unknown name new', () => {
        expect(classify('Nobody Inparticular', FILE).kind).toBe('new');
    });

    it('blocks an exact name already on the board', () => {
        const out = classify('Fernando Mendoza', FILE);
        expect(out.kind).toBe('exact');
        expect(out.match.name).toBe('Fernando Mendoza');
    });

    it('still catches him through punctuation and case, which is how a duplicate is actually typed', () => {
        // Not 'exact' — the typed string differs — but matched, and both
        // 'exact' and 'similar' stop the submit. What must never happen is
        // 'new', which would quietly make a second Fernando Mendoza.
        expect(classify('fernando  mendoza', FILE).kind).toBe('similar');
        expect(classify('Fernando Mendoza', FILE).kind).toBe('exact');
    });

    it('flags a near miss as similar rather than waving it through', () => {
        const out = classify('Fernando Mendoza Jr.', FILE);
        expect(out.kind).toBe('similar');
        expect(out.match.name).toBe('Fernando Mendoza');
    });

    it('lets two players share a name at different positions', () => {
        const roster = [{ name: 'Mike Green', position: 'EDGE' }];
        expect(classify('Mike Green', roster, 'WR').kind).toBe('new');
        expect(classify('Mike Green', roster, 'EDGE').kind).toBe('exact');
    });

    it('says nothing about an empty box', () => {
        expect(classify('   ', FILE).kind).toBe('empty');
    });
});

describe('a player added in the app', () => {
    it('joins the pool the board draws from', () => {
        addProspect({ name: 'Sleeper Guy', position: 'RB', school: 'Toledo' });
        expect(applyProspects(FILE).map(p => p.name)).toContain('Sleeper Guy');
    });

    it('arrives unplaced — he exists, nobody has ranked him', () => {
        addProspect({ name: 'Sleeper Guy', position: 'RB', school: 'Toledo' });
        const added = applyProspects(FILE).find(p => p.name === 'Sleeper Guy');
        expect(added.round ?? null).toBeNull();
    });

    it('is then blocked as a duplicate like anybody else', () => {
        addProspect({ name: 'Sleeper Guy', position: 'RB', school: 'Toledo' });
        expect(classify('Sleeper Guy', applyProspects(FILE)).kind).toBe('exact');
    });

    it('is deleted outright, not hidden — he was ours to begin with', () => {
        addProspect({ name: 'Sleeper Guy', position: 'RB', school: 'Toledo' });
        deletePlayer({ name: 'Sleeper Guy', position: 'RB' });

        expect(applyProspects(FILE).map(p => p.name)).not.toContain('Sleeper Guy');
        expect(hiddenPlayers()).toHaveLength(0);
        expect(loadProspects()).toHaveLength(0);
    });
});

describe('a player who came from a rankings file', () => {
    it('is corrected by an override, because the file is re-read every load', () => {
        savePlayerEdit(FILE[0], { school: 'Indiana Hoosiers' });
        const after = applyProspects(FILE).find(p => p.name === 'Fernando Mendoza');
        expect(after.school).toBe('Indiana Hoosiers');
    });

    it('takes a second correction on the same override rather than stacking them', () => {
        savePlayerEdit(FILE[0], { school: 'Wrong' });
        const once = applyProspects(FILE).find(p => p.name === 'Fernando Mendoza');
        savePlayerEdit(once, { school: 'Indiana' });

        const pool = applyProspects(FILE);
        expect(pool.filter(p => p.name === 'Fernando Mendoza')).toHaveLength(1);
        expect(pool.find(p => p.name === 'Fernando Mendoza').school).toBe('Indiana');
    });

    it('is removed by hiding him, and STAYS removed when the file is read again', () => {
        deletePlayer(FILE[1]);

        expect(applyProspects(FILE).map(p => p.name)).not.toContain('Arvell Reese');
        // The file has not changed — this is what "stays removed" means.
        expect(applyProspects(FILE).map(p => p.name)).not.toContain('Arvell Reese');
        expect(hiddenPlayers().map(p => p.name)).toEqual(['Arvell Reese']);
    });

    it('can be brought back, which nothing else can do', () => {
        deletePlayer(FILE[1]);
        expect(restorePlayer({ name: 'Arvell Reese', position: 'EDGE' })).toBe(true);
        expect(applyProspects(FILE).map(p => p.name)).toContain('Arvell Reese');
    });

    it('reports rather than pretends when there is nothing to restore', () => {
        expect(restorePlayer({ name: 'Never Hidden', position: 'QB' })).toBe(false);
    });

    it('is hidden once, however many times you remove him', () => {
        deletePlayer(FILE[1]);
        deletePlayer(FILE[1]);
        expect(hiddenPlayers()).toHaveLength(1);
    });
});

describe('the pool a board actually draws from', () => {
    it('is the file when nothing has been added, corrected or hidden', () => {
        expect(applyProspects(FILE).map(p => p.name)).toEqual(['Fernando Mendoza', 'Arvell Reese']);
    });

    it('survives being handed nothing at all', () => {
        expect(applyProspects(null)).toEqual([]);
    });
});
