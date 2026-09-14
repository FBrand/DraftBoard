import { describe, it, expect, beforeEach } from 'vitest';
import {
    EVALUATIONS, remarksPath, remarksFor, allRemarksFor,
    addRemark, removeRemark, updateRemarkText, openEvaluations,
} from '../../src/utils/evaluations';
import { repository } from '../../src/data/repository';

/**
 * Where a remark actually lives.
 *
 *     evaluations/{playerId}/{kind}/{ownerId}/{seasonId}/{remarkId}
 *
 * There is no composite key anywhere in it. Every part of a remark's identity
 * is something you select BY — the card wants one player's, a section wants
 * one kind's, a board wants one author's, the log wants one season's — and a
 * key that always has to be taken apart again was earning nothing.
 *
 * A document is one remark: `{ t: text, a: writtenAt }`, repeating none of the
 * five things the address states. Each remark used to carry a 46-byte uuid, a
 * 52-byte season id identical to its neighbours', and one of three words
 * spelled out: 116 of roughly 209 bytes.
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
    await repository.ready('seasons');
    // Reads walk the seasons that exist — see seasonCandidates. Writing into a
    // season the registry has never heard of is a real property with its own
    // test below, not something to leave lying under every other one.
    repository.set('seasons', S26, { id: S26, year: 2026, status: 'archived' });
    repository.set('seasons', S27, { id: S27, year: 2027, status: 'current' });
});

const docsAt = (kind, owner, season) =>
    Object.keys(repository.docs(remarksPath(PLAYER, kind, owner, season)) ?? {});

describe('the address', () => {
    it('puts the player, the kind, the owner and the season in the path', () => {
        expect(remarksPath(PLAYER, 'strength', OWNER, S26))
            .toBe(`evaluations/${PLAYER}/s/${OWNER}/${S26}`);
        expect(remarksPath(PLAYER, 'note', OWNER, null))
            .toBe(`evaluations/${PLAYER}/n/${OWNER}/-`);
    });

    it('files a remark at its own address and nowhere else', () => {
        addRemark(OWNER, PLAYER, 'strength', 'Sticky in man coverage', S26);

        expect(docsAt('strength', OWNER, S26)).toHaveLength(1);
        expect(docsAt('weakness', OWNER, S26)).toHaveLength(0);
        expect(docsAt('strength', OWNER, S27)).toHaveLength(0);
        expect(docsAt('strength', RYAN, S26)).toHaveLength(0);
    });

    it('separates the kinds', () => {
        addRemark(OWNER, PLAYER, 'strength', 'Sticky in man coverage', S26);
        addRemark(OWNER, PLAYER, 'weakness', 'Pursuit angles need work', S26);
        addRemark(OWNER, PLAYER, 'note', 'Compares to Quinyon Mitchell', S26);

        expect(docsAt('strength', OWNER, S26)).toHaveLength(1);
        expect(docsAt('weakness', OWNER, S26)).toHaveLength(1);
        expect(docsAt('note', OWNER, S26)).toHaveLength(1);
    });

    it('separates the seasons, which is what makes a log a log', () => {
        addRemark(OWNER, PLAYER, 'note', 'Bends the corner', S26);
        addRemark(OWNER, PLAYER, 'note', 'Lost a step after the knee', S27);

        expect(docsAt('note', OWNER, S26)).toHaveLength(1);
        expect(docsAt('note', OWNER, S27)).toHaveLength(1);
    });

    it('files an unstamped remark under a named sentinel, since a segment cannot be empty', () => {
        addRemark(OWNER, PLAYER, 'note', 'No season to hand', null);
        expect(docsAt('note', OWNER, null)).toHaveLength(1);
        expect(remarksFor(OWNER, PLAYER)[0].seasonId).toBeNull();
    });
});

describe('the stored document', () => {
    it('is the text and when it was written, and nothing else', () => {
        addRemark(OWNER, PLAYER, 'strength', 'Sticky in man coverage', S26);
        const docs = repository.docs(remarksPath(PLAYER, 'strength', OWNER, S26));
        const [id, doc] = Object.entries(docs)[0];

        expect(id).toMatch(/^[a-z0-9]{6}$/);
        expect(Object.keys(doc).sort()).toEqual(['a', 't']);
        expect(doc.t).toBe('Sticky in man coverage');
        expect(typeof doc.a).toBe('number');
    });

    it('repeats nothing the address already says', () => {
        addRemark(OWNER, PLAYER, 'weakness', 'Pursuit angles need work', S26);
        const raw = JSON.stringify(repository.docs(remarksPath(PLAYER, 'weakness', OWNER, S26)));

        expect(raw).not.toContain(S26);
        expect(raw).not.toContain(OWNER);
        expect(raw).not.toContain(PLAYER);
        expect(raw).not.toContain('weakness');
    });

    it('keeps several remarks of one kind apart', () => {
        addRemark(OWNER, PLAYER, 'strength', 'One', S26);
        addRemark(OWNER, PLAYER, 'strength', 'Two', S26);
        addRemark(OWNER, PLAYER, 'strength', 'Three', S26);

        expect(docsAt('strength', OWNER, S26)).toHaveLength(3);
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

        expect(remarksFor(OWNER, PLAYER).map(r => r.seasonId).sort()).toEqual([S26, S27]);
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

    it('keeps two players apart', () => {
        addRemark(OWNER, PLAYER, 'note', 'about Delane', S26);
        addRemark(OWNER, 'p_other', 'note', 'about somebody else', S26);

        expect(remarksFor(OWNER, PLAYER).map(r => r.text)).toEqual(['about Delane']);
    });

    it('is empty for a player nobody has written about', () => {
        expect(remarksFor(OWNER, 'p_nobody')).toEqual([]);
        expect(remarksFor(null, PLAYER)).toEqual([]);
    });

    it('cannot reach a season the registry no longer lists — the cost of the path', () => {
        // With every part of the address a path segment there is no key left
        // to scan, and Firestore cannot list subcollections from a browser. So
        // a read visits the seasons that EXIST. The remark is still stored and
        // comes straight back the moment the season is listed again: it is
        // unlisted, not lost. The previous shape scanned a key prefix and found
        // it regardless. Written down rather than discovered later.
        addRemark(OWNER, PLAYER, 'note', 'Written in a season since scrapped', 's_gone');
        expect(docsAt('note', OWNER, 's_gone')).toHaveLength(1);
        expect(remarksFor(OWNER, PLAYER)).toEqual([]);

        repository.set('seasons', 's_gone', { id: 's_gone', year: 2025, status: 'archived' });
        expect(remarksFor(OWNER, PLAYER).map(r => r.text))
            .toEqual(['Written in a season since scrapped']);
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

    it('treats an emptied edit as a removal', () => {
        const made = addRemark(OWNER, PLAYER, 'note', 'Something', S26);
        updateRemarkText(OWNER, PLAYER, made.id, '   ');
        expect(remarksFor(OWNER, PLAYER)).toEqual([]);
    });

    it('says no to a handle that matches nothing', () => {
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

    it('does not reach another owner with a matching handle', () => {
        const mine = addRemark(OWNER, PLAYER, 'note', 'Dan on Delane', S26);
        addRemark(RYAN, PLAYER, 'note', 'Ryan on Delane', S26);

        removeRemark(OWNER, PLAYER, mine.id);
        expect(remarksFor(RYAN, PLAYER).map(r => r.text)).toEqual(['Ryan on Delane']);
    });
});

describe('everybody on one player', () => {
    it('gathers the owners it is given', () => {
        addRemark(OWNER, PLAYER, 'strength', 'Dan likes the feet', S26);
        addRemark(RYAN, PLAYER, 'weakness', 'Ryan wants better angles', S26);

        const all = allRemarksFor(PLAYER, [OWNER, RYAN]);
        expect(all).toHaveLength(2);
        expect(all.map(r => r.ownerId).sort()).toEqual([OWNER, RYAN]);
        expect(all.find(r => r.ownerId === RYAN).text).toBe('Ryan wants better angles');
    });

    it('does not reach into another player', () => {
        addRemark(OWNER, PLAYER, 'note', 'about Delane', S26);
        addRemark(OWNER, 'p_other', 'note', 'about somebody else', S26);

        expect(allRemarksFor(PLAYER, [OWNER]).map(r => r.text)).toEqual(['about Delane']);
    });

    it('is empty rather than throwing when asked for nobody', () => {
        expect(allRemarksFor(PLAYER, [])).toEqual([]);
        expect(allRemarksFor(null, [OWNER])).toEqual([]);
    });
});

describe('remarks written by the older build', () => {
    const legacy = () => repository.set(EVALUATIONS, `${OWNER}__${PLAYER}`, {
        remarks: [
            { id: 'r_long-uuid-1', kind: 'strength', text: 'Old strength', seasonId: S26, createdAt: 1700000000000 },
            { id: 'r_long-uuid-2', kind: 'note', text: 'Old note', seasonId: S26, createdAt: 1700000000001 },
            { id: 'r_long-uuid-3', kind: 'note', text: 'Later season note', seasonId: S27, createdAt: 1700000000002 },
        ],
    });

    it('are read without being touched, so looking at a card writes nothing', () => {
        legacy();
        expect(remarksFor(OWNER, PLAYER).map(r => r.text).sort())
            .toEqual(['Later season note', 'Old note', 'Old strength']);
        // Converting on read would turn opening a player card into a write,
        // which is how a quota fills while somebody is only looking.
        expect(Object.keys(repository.docs(EVALUATIONS) ?? {})).toEqual([`${OWNER}__${PLAYER}`]);
        expect(docsAt('strength', OWNER, S26)).toHaveLength(0);
    });

    it('are moved to their addresses on the first write, keeping everything', () => {
        legacy();
        addRemark(OWNER, PLAYER, 'weakness', 'A new one', S26);

        expect(docsAt('strength', OWNER, S26)).toHaveLength(1);
        expect(docsAt('note', OWNER, S26)).toHaveLength(1);
        expect(docsAt('note', OWNER, S27)).toHaveLength(1);
        expect(docsAt('weakness', OWNER, S26)).toHaveLength(1);

        const all = remarksFor(OWNER, PLAYER);
        expect(all.map(r => r.text).sort())
            .toEqual(['A new one', 'Later season note', 'Old note', 'Old strength']);
        expect(all.find(r => r.text === 'Old strength').createdAt).toBe(1700000000000);
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
