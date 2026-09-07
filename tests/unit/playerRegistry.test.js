import { describe, it, expect, beforeEach } from 'vitest';
import { repository } from '../../src/data/repository';
import {
    PLAYERS, openRegistry, resolveAll, byId, fillMany, setFacts, clearRegistry,
} from '../../src/utils/playerRegistry';

async function freshRegistry(candidates) {
    globalThis.resetStorage();
    repository.invalidate?.();
    await openRegistry();
    clearRegistry();
    await openRegistry();
    return resolveAll(candidates);
}

describe('fillMany', () => {
    beforeEach(() => { globalThis.resetStorage(); });

    it('fills a blank field from the seed', async () => {
        const [id] = await freshRegistry([{ name: 'Fernando Mendoza', position: 'QB' }]);

        fillMany([{ id, base: { school: 'Indiana' }, facts: { draftRound: 1, draftPick: 1, team: 'LV' } }]);

        expect(byId(id)).toMatchObject({ school: 'Indiana', draftRound: 1, draftPick: 1, team: 'LV' });
    });

    it('never overwrites what somebody entered in the app', async () => {
        const [id] = await freshRegistry([{ name: 'Fernando Mendoza', position: 'QB', school: 'Indiana' }]);
        setFacts(id, { draftRound: 2 });

        fillMany([{ id, base: { school: 'Wrong State' }, facts: { draftRound: 1 } }]);

        // A seed is seed data; a correction is a deliberate act and outranks it.
        expect(byId(id)).toMatchObject({ school: 'Indiana', draftRound: 2 });
    });

    it('ignores an id that is on no board', () => {
        expect(fillMany([{ id: 'p_nobody', facts: { draftRound: 1 } }])).toBe(0);
    });

    it('reports how many records it actually changed, not how many it was offered', async () => {
        const ids = await freshRegistry([
            { name: 'A Player', position: 'QB' },
            { name: 'B Player', position: 'RB', school: 'Known' },
        ]);

        const changed = fillMany([
            { id: ids[0], base: { school: 'New' } },
            { id: ids[1], base: { school: 'Ignored' } },   // already has one
        ]);
        expect(changed).toBe(1);
    });

    /**
     * The bug this function exists for. Seeding through the per-player calls
     * rewrote the whole collection once per player — 257 rows became up to 514
     * full-collection writes on every page load, and crashed the renderer.
     */
    it('writes the collection once for the whole batch, not once per player', async () => {
        const roster = Array.from({ length: 60 }, (_, i) => ({ name: `Player ${i}`, position: 'WR' }));
        const ids = await freshRegistry(roster);

        let writes = 0;
        const setItem = globalThis.localStorage.setItem.bind(globalThis.localStorage);
        globalThis.localStorage.setItem = (k, v) => { if (k === `db_${PLAYERS}`) writes += 1; return setItem(k, v); };

        fillMany(ids.map((id, i) => ({ id, base: { school: `School ${i}` } })));

        expect(writes).toBe(1);
    });
});
