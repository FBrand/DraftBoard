import { describe, it, expect } from 'vitest';
import {
    buildNameIndex, findMatchingIndex, findMatchingPlayerIndex,
    identityKey, nameKey, resolvePlayerIndex,
} from '../../src/utils/nameMatcher.js';

const idx = (players) => buildNameIndex(players);

describe('the fuzzy cascade', () => {
    const roster = [
        { name: 'Patrick Mahomes', position: 'QB' },
        { name: "Ja'Marr Chase", position: 'WR' },
        { name: 'Marvin Harrison Jr.', position: 'WR' },
        { name: 'T.J. Watt', position: 'EDGE' },
    ];

    it('matches through punctuation and case', () => {
        expect(findMatchingIndex('ja marr chase', idx(roster))).toBe(1);
        expect(findMatchingIndex('PATRICK MAHOMES', idx(roster))).toBe(0);
    });

    it('matches through a suffix', () => {
        expect(findMatchingIndex('Marvin Harrison', idx(roster))).toBe(2);
        expect(findMatchingIndex('Marvin Harrison Jr', idx(roster))).toBe(2);
    });

    it('reports no match rather than guessing', () => {
        expect(findMatchingIndex('Somebody Else Entirely', idx(roster))).toBe(-1);
        expect(findMatchingIndex('', idx(roster))).toBe(-1);
        expect(findMatchingIndex('Patrick Mahomes', [])).toBe(-1);
    });
});

// Two men do turn up in one draft class with the same name. Merging them
// would put one man's tape under the other man's tier.
describe('a name is not an identity on its own', () => {
    const namesakes = [
        { name: 'Chris Jones', position: 'DL', school: 'Mississippi State' },
        { name: 'Chris Jones', position: 'WR', school: 'Ohio State' },
    ];

    it('tells them apart by position', () => {
        expect(findMatchingIndex('Chris Jones', idx(namesakes), { position: 'WR' })).toBe(1);
        expect(findMatchingIndex('Chris Jones', idx(namesakes), { position: 'DL' })).toBe(0);
    });

    it('tells them apart by school', () => {
        expect(findMatchingIndex('Chris Jones', idx(namesakes), { school: 'Ohio State' })).toBe(1);
    });

    it('accepts a bare position string as the qualifier', () => {
        expect(findMatchingIndex('Chris Jones', idx(namesakes), 'WR')).toBe(1);
    });

    it('says not-found rather than picking one when neither fits', () => {
        expect(findMatchingIndex('Chris Jones', idx(namesakes), { position: 'QB' })).toBe(-1);
    });

    it('keeps the old behaviour when the caller knows only a name', () => {
        // Scraped roster and ESPN data know nothing but a name; forcing a
        // qualifier through there would break legitimate matches.
        expect(findMatchingIndex('Chris Jones', idx(namesakes))).toBe(0);
    });
});

describe('only fields both sides declare can discriminate', () => {
    const partial = [{ name: 'Solo Player' }];   // no position, no school

    it('does not exclude a record that declares nothing', () => {
        // A missing field is not evidence of a difference — it simply cannot
        // tell anyone apart.
        expect(findMatchingIndex('Solo Player', idx(partial), { position: 'QB' })).toBe(0);
    });

    it('does not exclude when the caller declares nothing', () => {
        const known = [{ name: 'Solo Player', position: 'QB' }];
        expect(findMatchingIndex('Solo Player', idx(known), { school: '' })).toBe(0);
    });

    it('matches a depth-suffixed position against its base', () => {
        const slotted = [{ name: 'Slot Man', position: 'WR.Z' }];
        expect(findMatchingIndex('Slot Man', idx(slotted), { position: 'WR' })).toBe(0);
    });
});

// Joining three analyst files is not the same question as whether two
// players are the same person: analysts label one man DL and EDGE.
describe('keys for grouping large lists', () => {
    it('folds punctuation, case and suffix into the name key', () => {
        expect(nameKey('Marvin Harrison Jr.')).toBe(nameKey('marvin harrison'));
        expect(nameKey("Ja'Marr Chase")).toBe(nameKey('JaMarr Chase'));
    });

    it('separates the identity key by base position', () => {
        expect(identityKey('Chris Jones', 'DL')).not.toBe(identityKey('Chris Jones', 'WR'));
        expect(identityKey('Chris Jones', 'WR.Z')).toBe(identityKey('Chris Jones', 'WR'));
    });

    it('is why a join on position split one player in two', () => {
        // The bug: the same man, labelled differently by two analysts, got
        // two identity keys — and then two React rows with one key.
        expect(identityKey('Rueben Bain Jr', 'DL')).not.toBe(identityKey('Rueben Bain Jr', 'EDGE'));
        expect(nameKey('Rueben Bain Jr')).toBe(nameKey('Rueben Bain'));
    });
});

describe('the one-off wrapper', () => {
    it('matches the batched form', () => {
        const list = [{ name: 'Only One', position: 'TE' }];
        expect(findMatchingPlayerIndex('only one', list)).toBe(0);
    });
});

// The identity a normal operation (draft, sign, save) already has in hand —
// never re-derive it from a name when an id was sitting right there.
describe('resolvePlayerIndex — id-first for normal operation, fuzzy only as a fallback', () => {
    // OT/LT are the same position family in this app's own taxonomy (LT is
    // an alignment WITHIN OT, not a different position) — genuinely
    // different positions needed here so the qualifier actually discriminates.
    const list = [
        { id: 'p1', name: 'Diego Pounds', position: 'OT' },
        { id: 'p2', name: 'Diego Pounds', position: 'DT' },
    ];

    it('an id hit wins outright, even with two same-named players in the list', () => {
        expect(resolvePlayerIndex({ id: 'p2', name: 'Diego Pounds' }, list)).toBe(1);
        expect(resolvePlayerIndex({ id: 'p1', name: 'Diego Pounds' }, list)).toBe(0);
    });

    it('falls back to a qualified name match when the id is absent', () => {
        expect(resolvePlayerIndex({ name: 'Diego Pounds', position: 'DT' }, list)).toBe(1);
    });

    it('falls back when the id is present but not in THIS list (stale, or a different pool)', () => {
        expect(resolvePlayerIndex({ id: 'p9', name: 'Diego Pounds', position: 'OT' }, list)).toBe(0);
    });

    it('with no qualifier at all, matches the first same-named entry rather than refusing — the established name-only behaviour, unchanged by this helper', () => {
        expect(resolvePlayerIndex({ name: 'Diego Pounds' }, list)).toBe(0);
        expect(resolvePlayerIndex({}, list)).toBe(-1);
    });

    it('matches against a list keyed by a different id field, given the field name', () => {
        const entries = [{ playerId: 'p1', name: 'Diego Pounds' }, { playerId: 'p2', name: 'Diego Pounds' }];
        expect(resolvePlayerIndex({ id: 'p2', name: 'Diego Pounds' }, entries, 'playerId')).toBe(1);
    });
});
