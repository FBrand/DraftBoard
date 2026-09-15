import { describe, it, expect, beforeEach } from 'vitest';
import {
    remarksPath, remarksFor, allRemarksFor,
    addRemark, removeRemark, updateRemarkText, openEvaluations,
} from '../../src/utils/evaluations';
import { repository } from '../../src/data/repository';

/**
 * Where a remark actually lives.
 *
 *     evaluations/{playerId}/remarks/{ownerId}
 *       { "{seasonId}": { s: [["text", 1789418428790], …], w: […], n: […] } }
 *
 * The player comes first because of the read the app performs — the card shows
 * what everybody has written about one player. Season and kind are keys inside
 * the document rather than more path levels: splitting them out cost 183,750
 * characters of collection key at a full season's scale and bought nothing,
 * because nothing reads one kind of one season without wanting its neighbours.
 *
 * A remark is `[text, writtenAt]`. The six-character id it used to carry
 * existed only to find it inside its own array, and position does that.
 */
const OWNER = 'a_dan';
const RYAN = 'a_ryan';
const PLAYER = 'p_delane';
const S26 = 's_2026';
const S27 = 's_2027';

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openEvaluations();
});

const stored = (owner = OWNER) => repository.get(remarksPath(PLAYER), owner);
const ownerIds = () => Object.keys(repository.docs(remarksPath(PLAYER)) ?? {});

describe('the address', () => {
    it('is one collection per player, one document per owner', () => {
        expect(remarksPath(PLAYER)).toBe(`evaluations/${PLAYER}/remarks`);

        addRemark(OWNER, PLAYER, 'strength', 'Sticky in man coverage', S26);
        addRemark(RYAN, PLAYER, 'note', 'Ryan on Delane', S26);

        expect(ownerIds().sort()).toEqual([OWNER, RYAN]);
    });

    it('keeps another player out of it', () => {
        addRemark(OWNER, PLAYER, 'note', 'about Delane', S26);
        addRemark(OWNER, 'p_other', 'note', 'about somebody else', S26);

        expect(remarksFor(OWNER, PLAYER).map(r => r.text)).toEqual(['about Delane']);
        expect(remarksFor(OWNER, 'p_other').map(r => r.text)).toEqual(['about somebody else']);
    });
});

describe('the stored document', () => {
    it('is seasons, then kinds, then text and when it was written', () => {
        addRemark(OWNER, PLAYER, 'strength', 'Sticky in man coverage', S26);

        expect(stored()).toEqual({
            [S26]: { s: [{ t: 'Sticky in man coverage', a: expect.any(Number) }] },
        });
    });

    it('holds only the kinds that have something in them', () => {
        addRemark(OWNER, PLAYER, 'weakness', 'Pursuit angles need work', S26);
        expect(Object.keys(stored()[S26])).toEqual(['w']);
    });

    it('separates the seasons, which is what makes a log a log', () => {
        addRemark(OWNER, PLAYER, 'note', 'Bends the corner', S26);
        addRemark(OWNER, PLAYER, 'note', 'Lost a step after the knee', S27);

        expect(Object.keys(stored()).sort()).toEqual([S26, S27]);
    });

    it('files an unstamped remark under a named sentinel, not an empty key', () => {
        addRemark(OWNER, PLAYER, 'note', 'No season to hand', null);
        expect(Object.keys(stored())).toEqual(['-']);
        expect(remarksFor(OWNER, PLAYER)[0].seasonId).toBeNull();
    });

    it('spends no characters on a remark id', () => {
        addRemark(OWNER, PLAYER, 'strength', 'One', S26);
        const at = stored()[S26].s[0].a;
        expect(JSON.stringify(stored())).toBe(`{"${S26}":{"s":[{"t":"One","a":${at}}]}}`);
    });

    it('is a map inside an array, because Firestore refuses a nested array', () => {
        // "Nested arrays are not supported" — the emulator rejects
        // [["text", 1]] outright, so the cheapest shape both stores hold is a
        // map in an array.
        addRemark(OWNER, PLAYER, 'strength', 'One', S26);
        const [first] = stored()[S26].s;
        expect(Array.isArray(first)).toBe(false);
        expect(Object.keys(first).sort()).toEqual(['a', 't']);
    });

    it('keeps several remarks of one kind in order', () => {
        ['One', 'Two', 'Three'].forEach(t => addRemark(OWNER, PLAYER, 'strength', t, S26));
        expect(stored()[S26].s.map(r => r.t)).toEqual(['One', 'Two', 'Three']);
    });
});

describe('reading back', () => {
    it('returns the shape every caller already reads', () => {
        addRemark(OWNER, PLAYER, 'strength', 'Sticky in man coverage', S26);
        const [r] = remarksFor(OWNER, PLAYER);

        expect(r.kind).toBe('strength');
        expect(r.text).toBe('Sticky in man coverage');
        expect(r.seasonId).toBe(S26);
        expect(r.ownerId).toBe(OWNER);
        expect(typeof r.createdAt).toBe('number');
        expect(typeof r.id).toBe('string');
    });

    it('gathers every season, because an evaluation is a running log', () => {
        addRemark(OWNER, PLAYER, 'note', 'Bends the corner', S26);
        addRemark(OWNER, PLAYER, 'note', 'Lost a step after the knee', S27);

        expect(remarksFor(OWNER, PLAYER).map(r => r.seasonId).sort()).toEqual([S26, S27]);
    });

    it('finds a season the registry no longer lists', () => {
        // Reads no longer enumerate seasons, so scrapping one cannot make what
        // you learned unreachable. That was a real cost of the previous shape.
        addRemark(OWNER, PLAYER, 'note', 'Written in a season since scrapped', 's_gone');
        expect(remarksFor(OWNER, PLAYER).map(r => r.text))
            .toEqual(['Written in a season since scrapped']);
    });

    it('orders by kind, then oldest first within a kind', () => {
        addRemark(OWNER, PLAYER, 'note', 'a note', S26);
        addRemark(OWNER, PLAYER, 'strength', 'a strength', S26);
        addRemark(OWNER, PLAYER, 'weakness', 'a weakness', S26);

        expect(remarksFor(OWNER, PLAYER).map(r => r.kind))
            .toEqual(['strength', 'weakness', 'note']);
    });

    it('keeps two owners apart', () => {
        addRemark(OWNER, PLAYER, 'note', 'Dan on Delane', S26);
        addRemark(RYAN, PLAYER, 'note', 'Ryan on Delane', S26);

        expect(remarksFor(OWNER, PLAYER).map(r => r.text)).toEqual(['Dan on Delane']);
        expect(remarksFor(RYAN, PLAYER).map(r => r.text)).toEqual(['Ryan on Delane']);
    });

    it('is empty for a player nobody has written about', () => {
        expect(remarksFor(OWNER, 'p_nobody')).toEqual([]);
        expect(remarksFor(null, PLAYER)).toEqual([]);
    });
});

describe('editing and removing', () => {
    it('rewords without moving the time it was written', () => {
        const made = addRemark(OWNER, PLAYER, 'note', 'Typo heer', S26);
        const before = remarksFor(OWNER, PLAYER)[0].createdAt;

        expect(updateRemarkText(OWNER, PLAYER, made.id, 'Typo here')).toBe(true);
        const [after] = remarksFor(OWNER, PLAYER);
        expect(after.text).toBe('Typo here');
        expect(after.createdAt).toBe(before);
    });

    it('removes one and leaves its siblings, closing the gap', () => {
        ['One', 'Two', 'Three'].forEach(t => addRemark(OWNER, PLAYER, 'strength', t, S26));
        const two = remarksFor(OWNER, PLAYER).find(r => r.text === 'Two');

        expect(removeRemark(OWNER, PLAYER, two.id)).toBe(true);
        expect(remarksFor(OWNER, PLAYER).map(r => r.text)).toEqual(['One', 'Three']);
    });

    it('drops the document once the last remark goes, rather than leaving a husk', () => {
        const only = addRemark(OWNER, PLAYER, 'note', 'Only one', S26);
        removeRemark(OWNER, PLAYER, only.id);
        expect(ownerIds()).toEqual([]);
    });

    it('drops an emptied season without touching the others', () => {
        const old = addRemark(OWNER, PLAYER, 'note', 'From 2026', S26);
        addRemark(OWNER, PLAYER, 'note', 'From 2027', S27);

        removeRemark(OWNER, PLAYER, old.id);
        expect(Object.keys(stored())).toEqual([S27]);
    });

    it('treats an emptied edit as a removal', () => {
        const made = addRemark(OWNER, PLAYER, 'note', 'Something', S26);
        updateRemarkText(OWNER, PLAYER, made.id, '   ');
        expect(remarksFor(OWNER, PLAYER)).toEqual([]);
    });

    it('says no to a handle that matches nothing', () => {
        addRemark(OWNER, PLAYER, 'note', 'Something', S26);
        expect(removeRemark(OWNER, PLAYER, `${S26}:n:7`)).toBe(false);
        expect(removeRemark(OWNER, PLAYER, 'nonsense')).toBe(false);
        expect(updateRemarkText(OWNER, PLAYER, 'nonsense', 'x')).toBe(false);
        expect(remarksFor(OWNER, PLAYER)).toHaveLength(1);
    });

    it('does not reach another owner with a matching handle', () => {
        const mine = addRemark(OWNER, PLAYER, 'note', 'Dan on Delane', S26);
        addRemark(RYAN, PLAYER, 'note', 'Ryan on Delane', S26);

        removeRemark(OWNER, PLAYER, mine.id);
        expect(remarksFor(RYAN, PLAYER).map(r => r.text)).toEqual(['Ryan on Delane']);
    });

    it('removes the right remark when two seasons hold the same kind', () => {
        const old = addRemark(OWNER, PLAYER, 'note', 'From 2026', S26);
        addRemark(OWNER, PLAYER, 'note', 'From 2027', S27);

        removeRemark(OWNER, PLAYER, old.id);
        expect(remarksFor(OWNER, PLAYER).map(r => r.text)).toEqual(['From 2027']);
    });
});

describe('everybody on one player', () => {
    it('gathers every owner in one collection read', () => {
        addRemark(OWNER, PLAYER, 'strength', 'Dan likes the feet', S26);
        addRemark(RYAN, PLAYER, 'weakness', 'Ryan wants better angles', S26);

        const all = allRemarksFor(PLAYER);
        expect(all).toHaveLength(2);
        expect(all.map(r => r.ownerId).sort()).toEqual([OWNER, RYAN]);
        expect(all.find(r => r.ownerId === RYAN).text).toBe('Ryan wants better angles');
    });

    it('does not reach into another player', () => {
        addRemark(OWNER, PLAYER, 'note', 'about Delane', S26);
        addRemark(OWNER, 'p_other', 'note', 'about somebody else', S26);

        expect(allRemarksFor(PLAYER).map(r => r.text)).toEqual(['about Delane']);
    });

    it('is empty rather than throwing for a player nobody has written about', () => {
        expect(allRemarksFor('p_nobody')).toEqual([]);
        expect(allRemarksFor(null)).toEqual([]);
    });
});
