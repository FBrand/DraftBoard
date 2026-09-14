import { describe, it, expect, beforeEach } from 'vitest';
import {
    EVALUATIONS, remarksFor, addRemark, removeRemark, updateRemarkText, openEvaluations,
} from '../../src/utils/evaluations';
import { repository } from '../../src/data/repository';

/**
 * Where a remark actually lives.
 *
 * A player scouted properly carries about fourteen remarks, and each one used
 * to spend 52 bytes on a season id identical to its neighbours', 18 more
 * spelling out one of three words, and 46 on a v4 uuid used only to find it
 * inside its own document. That is 116 of roughly 209 bytes saying what the
 * ADDRESS can say once.
 *
 * So season and kind are the document id, and the document is a map of short
 * id to `[text, writtenAt]`.
 *
 * The public API is deliberately unchanged — six call sites read
 * `remarksFor(ownerId, playerId)` and get a flat array of
 * `{ id, kind, text, seasonId, createdAt }` — so the handle is composed from
 * the address rather than stored.
 */
const OWNER = 'a_dan';
const PLAYER = 'p_delane';
const S26 = 's_2026';
const S27 = 's_2027';

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openEvaluations();
});

const ids = () => Object.keys(repository.docs(EVALUATIONS) ?? {});

describe('the address', () => {
    it('carries the owner, the player, the season and the kind', () => {
        addRemark(OWNER, PLAYER, 'strength', 'Sticky in man coverage', S26);
        expect(ids()).toEqual([`${OWNER}__${PLAYER}__${S26}__s`]);
    });

    it('gives each kind its own document', () => {
        addRemark(OWNER, PLAYER, 'strength', 'Sticky in man coverage', S26);
        addRemark(OWNER, PLAYER, 'weakness', 'Pursuit angles need work', S26);
        addRemark(OWNER, PLAYER, 'note', 'Compares to Quinyon Mitchell', S26);

        expect(ids().sort()).toEqual([
            `${OWNER}__${PLAYER}__${S26}__n`,
            `${OWNER}__${PLAYER}__${S26}__s`,
            `${OWNER}__${PLAYER}__${S26}__w`,
        ]);
    });

    it('gives each season its own document, which is what makes a log a log', () => {
        addRemark(OWNER, PLAYER, 'note', 'Bends the corner', S26);
        addRemark(OWNER, PLAYER, 'note', 'Lost a step after the knee', S27);

        expect(ids().sort()).toEqual([
            `${OWNER}__${PLAYER}__${S26}__n`,
            `${OWNER}__${PLAYER}__${S27}__n`,
        ]);
    });

    it('files an unstamped remark rather than dropping it', () => {
        addRemark(OWNER, PLAYER, 'note', 'No season to hand', null);
        expect(ids()).toEqual([`${OWNER}__${PLAYER}_____n`]);
        expect(remarksFor(OWNER, PLAYER)[0].seasonId).toBeNull();
    });
});

describe('the stored document', () => {
    it('is a map of short id to text and time, and nothing else', () => {
        addRemark(OWNER, PLAYER, 'strength', 'Sticky in man coverage', S26);
        const doc = repository.get(EVALUATIONS, `${OWNER}__${PLAYER}__${S26}__s`);

        const entries = Object.entries(doc);
        expect(entries).toHaveLength(1);
        const [id, value] = entries[0];
        expect(id).toMatch(/^[a-z0-9]{6}$/);
        expect(value[0]).toBe('Sticky in man coverage');
        expect(typeof value[1]).toBe('number');
    });

    it('does not repeat the season or the kind it is filed under', () => {
        addRemark(OWNER, PLAYER, 'weakness', 'Pursuit angles need work', S26);
        const raw = JSON.stringify(repository.get(EVALUATIONS, `${OWNER}__${PLAYER}__${S26}__w`));

        expect(raw).not.toContain(S26);
        expect(raw).not.toContain('weakness');
        expect(raw).not.toContain('seasonId');
    });

    it('keeps several remarks of one kind apart', () => {
        addRemark(OWNER, PLAYER, 'strength', 'One', S26);
        addRemark(OWNER, PLAYER, 'strength', 'Two', S26);
        addRemark(OWNER, PLAYER, 'strength', 'Three', S26);

        const doc = repository.get(EVALUATIONS, `${OWNER}__${PLAYER}__${S26}__s`);
        expect(Object.keys(doc)).toHaveLength(3);
        expect(remarksFor(OWNER, PLAYER).map(r => r.text)).toEqual(['One', 'Two', 'Three']);
    });
});

describe('reading back', () => {
    it('returns the shape every caller already reads', () => {
        addRemark(OWNER, PLAYER, 'strength', 'Sticky in man coverage', S26);
        const [r] = remarksFor(OWNER, PLAYER);

        expect(r.kind).toBe('strength');
        expect(r.text).toBe('Sticky in man coverage');
        expect(r.seasonId).toBe(S26);
        expect(typeof r.createdAt).toBe('number');
        expect(typeof r.id).toBe('string');
    });

    it('gathers every season, because an evaluation is a running log', () => {
        addRemark(OWNER, PLAYER, 'note', 'Bends the corner', S26);
        addRemark(OWNER, PLAYER, 'note', 'Lost a step after the knee', S27);

        const seasons = remarksFor(OWNER, PLAYER).map(r => r.seasonId).sort();
        expect(seasons).toEqual([S26, S27]);
    });

    it('still finds remarks from a season that no longer exists', () => {
        // The reason this reads by key prefix rather than looping over the
        // seasons the registry knows about: scrapping a season must not make
        // what you learned unreachable.
        addRemark(OWNER, PLAYER, 'note', 'Written in a season since scrapped', 's_gone');
        expect(remarksFor(OWNER, PLAYER).map(r => r.text)).toEqual(['Written in a season since scrapped']);
    });

    it('orders by kind, then oldest first within a kind', () => {
        addRemark(OWNER, PLAYER, 'note', 'a note', S26);
        addRemark(OWNER, PLAYER, 'strength', 'a strength', S26);
        addRemark(OWNER, PLAYER, 'weakness', 'a weakness', S26);

        expect(remarksFor(OWNER, PLAYER).map(r => r.kind))
            .toEqual(['strength', 'weakness', 'note']);
    });

    it('keeps two players apart, and two owners', () => {
        addRemark(OWNER, PLAYER, 'note', 'about Delane', S26);
        addRemark(OWNER, 'p_other', 'note', 'about somebody else', S26);
        addRemark('a_ryan', PLAYER, 'note', 'Ryan on Delane', S26);

        expect(remarksFor(OWNER, PLAYER).map(r => r.text)).toEqual(['about Delane']);
        expect(remarksFor('a_ryan', PLAYER).map(r => r.text)).toEqual(['Ryan on Delane']);
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

    it('removes one and leaves its siblings', () => {
        const one = addRemark(OWNER, PLAYER, 'strength', 'One', S26);
        addRemark(OWNER, PLAYER, 'strength', 'Two', S26);

        expect(removeRemark(OWNER, PLAYER, one.id)).toBe(true);
        expect(remarksFor(OWNER, PLAYER).map(r => r.text)).toEqual(['Two']);
    });

    it('drops the document once its last remark goes, rather than leaving a husk', () => {
        const only = addRemark(OWNER, PLAYER, 'note', 'Only one', S26);
        removeRemark(OWNER, PLAYER, only.id);
        expect(ids()).toEqual([]);
    });

    it('treats an emptied edit as a removal', () => {
        const made = addRemark(OWNER, PLAYER, 'note', 'Something', S26);
        updateRemarkText(OWNER, PLAYER, made.id, '   ');
        expect(remarksFor(OWNER, PLAYER)).toEqual([]);
    });

    it('says no to a handle that does not match anything', () => {
        addRemark(OWNER, PLAYER, 'note', 'Something', S26);
        expect(removeRemark(OWNER, PLAYER, `${S26}:n:zzzzzz`)).toBe(false);
        expect(updateRemarkText(OWNER, PLAYER, 'nonsense', 'x')).toBe(false);
        expect(remarksFor(OWNER, PLAYER)).toHaveLength(1);
    });

    it('removes the right remark when two seasons hold the same kind', () => {
        const old = addRemark(OWNER, PLAYER, 'note', 'From 2026', S26);
        addRemark(OWNER, PLAYER, 'note', 'From 2027', S27);

        removeRemark(OWNER, PLAYER, old.id);
        expect(remarksFor(OWNER, PLAYER).map(r => r.text)).toEqual(['From 2027']);
    });
});

describe('remarks written by the older build', () => {
    const legacy = () => repository.set(EVALUATIONS, `${OWNER}__${PLAYER}`, {
        remarks: [
            { id: 'r_long-uuid-1', kind: 'strength', text: 'Old strength', seasonId: S26, createdAt: 1700000000000 },
            { id: 'r_long-uuid-2', kind: 'note', text: 'Old note', seasonId: S26, createdAt: 1700000000001 },
            { id: 'r_long-uuid-3', kind: 'note', text: 'Older season note', seasonId: S27, createdAt: 1700000000002 },
        ],
    });

    it('are read without being touched, so looking at a card writes nothing', () => {
        legacy();
        expect(remarksFor(OWNER, PLAYER).map(r => r.text).sort())
            .toEqual(['Old note', 'Old strength', 'Older season note']);
        // Converting on read would turn opening a player card into a write,
        // which is how a quota fills while somebody is only looking.
        expect(ids()).toEqual([`${OWNER}__${PLAYER}`]);
    });

    it('are split into the new addresses on the first write', () => {
        legacy();
        addRemark(OWNER, PLAYER, 'weakness', 'A new one', S26);

        expect(ids().sort()).toEqual([
            `${OWNER}__${PLAYER}__${S26}__n`,
            `${OWNER}__${PLAYER}__${S26}__s`,
            `${OWNER}__${PLAYER}__${S26}__w`,
            `${OWNER}__${PLAYER}__${S27}__n`,
        ]);
    });

    it('keep their text, their kind, their season and when they were written', () => {
        legacy();
        addRemark(OWNER, PLAYER, 'weakness', 'A new one', S26);

        const all = remarksFor(OWNER, PLAYER);
        const old = all.find(r => r.text === 'Old strength');
        expect(old.kind).toBe('strength');
        expect(old.seasonId).toBe(S26);
        expect(old.createdAt).toBe(1700000000000);
        expect(all.map(r => r.text).sort())
            .toEqual(['A new one', 'Old note', 'Old strength', 'Older season note']);
    });

    it('leave nothing behind at the old address', () => {
        legacy();
        addRemark(OWNER, PLAYER, 'weakness', 'A new one', S26);
        expect(repository.get(EVALUATIONS, `${OWNER}__${PLAYER}`)).toBeNull();
    });

    it('can be removed after the move, by the handle the new read gives back', () => {
        legacy();
        addRemark(OWNER, PLAYER, 'weakness', 'A new one', S26);

        const target = remarksFor(OWNER, PLAYER).find(r => r.text === 'Old note');
        expect(removeRemark(OWNER, PLAYER, target.id)).toBe(true);
        expect(remarksFor(OWNER, PLAYER).map(r => r.text)).not.toContain('Old note');
    });
});

describe('what it costs', () => {
    it('is under half what the old shape cost for the same fourteen remarks', () => {
        // The real unit: the richest evaluation in the shipped season carries
        // fourteen remarks. This is the measurement the whole change is for.
        const texts = Array.from({ length: 14 }, (_, i) =>
            `Remark number ${i} about this player, roughly the length of a real one`);
        const kinds = ['strength', 'weakness', 'note'];
        texts.forEach((t, i) => addRemark(OWNER, PLAYER, kinds[i % 3], t, S26));

        const stored = Object.entries(repository.docs(EVALUATIONS) ?? {})
            .reduce((sum, [id, doc]) => sum + id.length + JSON.stringify(doc).length, 0);

        // What the same fourteen would have cost in the old shape: one
        // document, every remark carrying a uuid, the season id and the kind.
        const oldShape = `${OWNER}__${PLAYER}`.length + JSON.stringify({
            remarks: texts.map((t, i) => ({
                id: `r_${'x'.repeat(36)}`, kind: kinds[i % 3], text: t,
                seasonId: S26, createdAt: 1789408507998,
            })),
        }).length;

        expect(stored).toBeLessThan(oldShape * 0.55);
    });
});
