import { describe, it, expect, beforeEach } from 'vitest';
import { repository } from '../../src/data/repository';
import { openBoards } from '../../src/utils/boardRegistry';
import { resolveAll, loadRegistry } from '../../src/utils/playerRegistry';
import { parseCSV } from '../../src/utils/rosterState';
import { buildNameIndex, findMatchingIndex } from '../../src/utils/nameMatcher';

/**
 * One man, one record — across vocabularies.
 *
 * The registry exists because the same bug kept coming back in new disguises,
 * and CLAUDE.md names this one: "two analysts labelling one player at different
 * positions". It had come back in the shipped data — twelve men held twice,
 * because the ROSTER speaks in alignments (LDE, LG, NT) and the rankings files
 * speak in positions (EDGE, OG, DT), and a label from another vocabulary was
 * being read as evidence of a different man.
 *
 * What makes it expensive rather than untidy: his facts land on one record and
 * his board placement on the other, so his card shows neither.
 */
const PLAYERS = 'players';

beforeEach(async () => {
    repository.invalidate();
    await repository.ready(PLAYERS);
    const existing = repository.docs(PLAYERS) ?? {};
    const drop = Object.keys(existing).map(id => ({ id, doc: null }));
    if (drop.length) await repository.commit(PLAYERS, drop);
    await openBoards();
});

const roster = (rows) => ['Phase,pos,slots53,slot1', ...rows].join('\n') + '\n';

describe('a roster row for a player the board already knows', () => {
    it('does not mint a second record for an alignment label', () => {
        const [id] = resolveAll([{ name: 'Peter Woods', position: 'DL', school: 'Clemson' }]);
        const before = loadRegistry().length;

        // The roster calls the same man a DT — a different vocabulary, not a
        // different player.
        parseCSV(roster(['D,DT,1,Peter Woods']));

        expect(loadRegistry().length).toBe(before);
        expect(loadRegistry().filter(p => p.name === 'Peter Woods')).toHaveLength(1);
        expect(loadRegistry().find(p => p.name === 'Peter Woods').id).toBe(id);
    });

    it('does not mint a second record for an edge alignment either', () => {
        resolveAll([{ name: 'R Mason Thomas', position: 'EDGE', school: 'Oklahoma' }]);
        const before = loadRegistry().length;

        parseCSV(roster(['D,LDE,1,R Mason Thomas']));

        expect(loadRegistry().length).toBe(before);
        expect(loadRegistry().filter(p => p.name === 'R Mason Thomas')).toHaveLength(1);
    });

    it('keeps the school the rankings file gave him', () => {
        // The point of not splitting him: one record carries everything.
        resolveAll([{ name: 'Peter Woods', position: 'DL', school: 'Clemson' }]);
        parseCSV(roster(['D,DT,1,Peter Woods']));

        expect(loadRegistry().find(p => p.name === 'Peter Woods').school).toBe('Clemson');
    });

    it('still registers a roster player nobody has heard of', () => {
        const before = loadRegistry().length;
        parseCSV(roster(['O,QB,1,Somebody Entirely New']));

        expect(loadRegistry().length).toBe(before + 1);
    });
});

describe('a position that declares nothing', () => {
    it('does not tell two players apart', () => {
        // URA is this app's "Unranked Placeholder", written by the live sync
        // for a player the board has never heard of, and carried in the shipped
        // picks file. It says the position is UNKNOWN — the opposite of
        // evidence — and was being read as a difference.
        const index = buildNameIndex([{ name: 'Enrique Cruz Jr', position: 'OT', school: 'Kansas' }]);

        expect(findMatchingIndex('Enrique Cruz Jr', index, { position: 'URA' })).toBe(0);
    });

    it('still tells two genuinely different positions apart', () => {
        // The guard must not become "never discriminate": two men really do
        // share a name in one draft class.
        const index = buildNameIndex([
            { name: 'Mike Williams', position: 'WR', school: 'Clemson' },
            { name: 'Mike Williams', position: 'DT', school: 'LSU' },
        ]);

        expect(findMatchingIndex('Mike Williams', index, { position: 'DT' })).toBe(1);
        expect(findMatchingIndex('Mike Williams', index, { position: 'WR' })).toBe(0);
    });
});
