import { describe, it, expect, beforeEach, vi } from 'vitest';
import { repository } from '../../src/data/repository';
import { resolveAll, fillMany, byId, setFacts } from '../../src/utils/playerRegistry';

/**
 * Seed data fills blanks. It never overwrites a correction.
 *
 * `player_facts_2026.csv` is applied on load to give every record a school and
 * the draft outcome the rankings files cannot carry. It is seed data, not
 * truth: the analyst may have already fixed a school that the file has wrong,
 * and a seed that overwrote him would undo the correction on the next load,
 * silently, with no way to tell it had happened.
 *
 * The guarantee lives in `fillMany`, which had no test of its own.
 */
const PLAYERS = 'players';

beforeEach(async () => {
    repository.invalidate();
    await repository.ready(PLAYERS);
    const existing = repository.docs(PLAYERS) ?? {};
    const drop = Object.keys(existing).map(id => ({ id, doc: null }));
    if (drop.length) await repository.commit(PLAYERS, drop);
});

const register = (name, position = 'WR') => resolveAll([{ name, position }])[0];

describe('filling blanks', () => {
    it('gives a record the school it was missing', () => {
        const id = register('Arvell Reese', 'EDGE');
        expect(byId(id).school).toBe('');

        fillMany([{ id, base: { school: 'Ohio State' }, facts: {} }]);
        expect(byId(id).school).toBe('Ohio State');
    });

    it('leaves a school somebody has already corrected', () => {
        // The failure this exists to prevent: the file says one thing, the
        // analyst has fixed it to another, and the next load undoes him.
        const id = resolveAll([{ name: 'Arvell Reese', position: 'EDGE', school: 'Corrected U' }])[0];
        expect(byId(id).school).toBe('Corrected U');

        fillMany([{ id, base: { school: 'Ohio State' }, facts: {} }]);
        expect(byId(id).school).toBe('Corrected U');
    });

    it('fills a draft outcome that is unknown', () => {
        const id = register('Zane Durant', 'DL');
        fillMany([{ id, base: {}, facts: { draftYear: 2026, draftRound: 2, draftPick: 41, team: 'KC' } }]);

        expect(byId(id)).toMatchObject({ draftYear: 2026, draftRound: 2, draftPick: 41, team: 'KC' });
    });

    it('leaves a draft outcome the app has already recorded', () => {
        const id = register('Zane Durant', 'DL');
        setFacts(id, { draftPick: 7, team: 'NYG' });

        fillMany([{ id, base: {}, facts: { draftPick: 41, team: 'KC' } }]);
        expect(byId(id)).toMatchObject({ draftPick: 7, team: 'NYG' });
    });

    it('treats isUdfa false as known, not as blank', () => {
        // null is "nobody has said"; false is "he was drafted". A seed that
        // read false as missing would keep rewriting it.
        const id = register('Somebody Drafted', 'CB');
        setFacts(id, { isUdfa: false });

        fillMany([{ id, base: {}, facts: { isUdfa: true } }]);
        expect(byId(id).isUdfa).toBe(false);
    });

    it('writes nothing at all when there is nothing to fill', () => {
        const id = resolveAll([{ name: 'Complete Player', position: 'QB', school: 'Indiana' }])[0];
        setFacts(id, { draftPick: 1, team: 'KC' });

        const spy = vi.spyOn(repository, 'commit');
        const filled = fillMany([{ id, base: { school: 'Indiana' }, facts: { draftPick: 1, team: 'KC' } }]);

        expect(filled).toBe(0);
        expect(spy.mock.calls.filter(([c]) => c === PLAYERS)).toHaveLength(0);
        spy.mockRestore();
    });

    it('commits once for the whole batch, however many players it fills', () => {
        // The lesson CLAUDE.md records at 514 writes: a per-player call rewrites
        // the entire collection each time and crashed the renderer.
        const ids = resolveAll(
            Array.from({ length: 40 }, (_, i) => ({ name: `Player Number ${i}`, position: 'WR' })),
        );
        const spy = vi.spyOn(repository, 'commit');

        const filled = fillMany(ids.map(id => ({ id, base: { school: 'Somewhere' }, facts: {} })));

        expect(filled).toBe(40);
        expect(spy.mock.calls.filter(([c]) => c === PLAYERS)).toHaveLength(1);
        spy.mockRestore();
    });

    it('ignores an update for a player who is not registered', () => {
        expect(fillMany([{ id: 'p_nobody', base: { school: 'Nowhere' }, facts: {} }])).toBe(0);
    });
});
