import { describe, it, expect, beforeEach, vi } from 'vitest';
import { repository } from '../../src/data/repository';
import { openBoards, currentSeason } from '../../src/utils/boardRegistry';
import { openProspects, prospectsPath, hiddenPath, editsPath } from '../../src/data/prospectStore';
import { writeStage } from '../../src/data/stageStore';
import { addProspect, loadProspects, deletePlayer, restorePlayer, hiddenPlayers, savePlayerEdit, applyProspects } from '../../src/utils/prospects';

/**
 * A player added in the app is a document, not an element of a blob.
 *
 * `prospects_v1` was one stage document holding three arrays, and every mutation
 * read it, changed one element and wrote the whole thing back. Two experts adding
 * a player both did that, and the second write carried the first's absence — so
 * one of them lost his player, silently, with the player still on his screen
 * until a reload took him off.
 *
 * These tests are about the WRITE, not the result: a blob and a record produce
 * the same list when only one person is writing, which is why this went
 * unnoticed. What distinguishes them is how much each write touches.
 */
const sid = () => currentSeason()?.id;
const docsIn = (path) => Object.keys(repository.docs(path) ?? {});

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openBoards();
    await openProspects(sid());
});

describe('adding a player', () => {
    it('writes one document for him, and nothing else', () => {
        const spy = vi.spyOn(repository, 'set');
        addProspect({ name: 'Late Riser', position: 'WR', school: 'Toledo' });

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toBe(prospectsPath(sid()));
        spy.mockRestore();
    });

    it('does not disturb a player somebody else added', () => {
        // The failure the blob had. Two adds, two documents — where the array
        // version wrote the whole list twice and the second write decided what
        // the list contained.
        addProspect({ name: 'First Add', position: 'WR', school: 'A' });
        addProspect({ name: 'Second Add', position: 'RB', school: 'B' });

        expect(docsIn(prospectsPath(sid()))).toHaveLength(2);
        expect(loadProspects().map(p => p.name).sort()).toEqual(['First Add', 'Second Add']);
    });

    it('is one document however many times the same player is added', () => {
        addProspect({ name: 'Same Man', position: 'TE', school: 'Iowa' });
        addProspect({ name: 'Same Man', position: 'TE', school: 'Iowa' });

        expect(docsIn(prospectsPath(sid()))).toHaveLength(1);
    });
});

describe('hiding and restoring a file player', () => {
    it('is one marker however many times he is hidden', () => {
        const him = { name: 'File Player', position: 'CB', school: 'LSU' };
        deletePlayer(him);
        deletePlayer(him);

        expect(docsIn(hiddenPath(sid()))).toHaveLength(1);
        expect(hiddenPlayers().map(h => h.name)).toEqual(['File Player']);
    });

    it('comes back when restored', () => {
        const him = { name: 'File Player', position: 'CB', school: 'LSU' };
        deletePlayer(him);
        expect(restorePlayer(him)).toBe(true);

        expect(hiddenPlayers()).toHaveLength(0);
        expect(docsIn(hiddenPath(sid()))).toHaveLength(0);
    });
});

describe('correcting a file player', () => {
    it('replaces the previous correction rather than stacking beside it', () => {
        const him = { name: 'Mis Spelled', position: 'QB', school: 'Duke' };
        savePlayerEdit(him, { name: 'Mis Spelled', position: 'QB', school: 'Duke State' });
        savePlayerEdit(him, { name: 'Mis Spelled', position: 'QB', school: 'Duke University' });

        expect(docsIn(editsPath(sid()))).toHaveLength(1);
        const [applied] = applyProspects([him]);
        expect(applied.school).toBe('Duke University');
    });
});

describe('the blob that is still out there', () => {
    it('is read, and a record written since wins over it', () => {
        // Every browser that has used this app has one. It is never rewritten —
        // converting it in place would be a bulk write during a load, which is
        // the thing that crashed a renderer here once already.
        writeStage('prospects_v1', sid(), {
            version: 1,
            players: [{ name: 'From The Blob', position: 'DL', school: 'Old' }],
            edits: [],
            hidden: [],
        });

        expect(loadProspects().map(p => p.name)).toContain('From The Blob');

        // Correct him: the correction is a document, and the old copy does not
        // reappear beside it.
        savePlayerEdit(
            { name: 'From The Blob', position: 'DL', school: 'Old' },
            { name: 'From The Blob', position: 'DL', school: 'New' },
        );
        const names = loadProspects().filter(p => p.name === 'From The Blob');
        expect(names).toHaveLength(1);
        expect(names[0].school).toBe('New');
    });
});
