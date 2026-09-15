import { describe, it, expect, beforeEach, vi } from 'vitest';
import { repository } from '../../src/data/repository';
import { createDocSet } from '../../src/data/docSet';

/**
 * The list the app hands over whole, written as the documents that differ.
 *
 * Every store here holds a whole stage in memory and saves all of it on every
 * edit. Writing it whole is how two people editing different parts overwrite
 * each other, and it is also how a React view that re-saves on every render
 * costs a full write each time. So the shape stays and the WRITE diffs.
 *
 * It had no test of its own, and two things now lean on it: the roster survives
 * the app being open in two tabs BECAUSE a stale tab has no opinion about rows
 * it did not touch, and "nothing changed is no write at all" is what keeps a
 * re-render from being a save.
 */
const COLLECTION = 'test_docset';

const set = createDocSet({
    collection: COLLECTION,
    idOf: (scope, item) => `${scope}__${item.rowId}`,
    strip: (doc) => { const { order, ...rest } = doc; return rest; },
});

beforeEach(async () => {
    repository.invalidate();
    await repository.ready(COLLECTION);
    const existing = repository.docs(COLLECTION) ?? {};
    const drop = Object.keys(existing).map(id => ({ id, doc: null }));
    if (drop.length) await repository.commit(COLLECTION, drop);
});

const rows = (...labels) => labels.map((l, i) => ({ rowId: l, label: l, n: i }));

describe('writing a list', () => {
    it('writes every document the first time', () => {
        expect(set.write('s1', rows('QB', 'RB', 'WR'))).toBe(3);
        expect(set.read('s1')).toHaveLength(3);
    });

    it('writes nothing at all when nothing changed', () => {
        set.write('s1', rows('QB', 'RB'));
        const spy = vi.spyOn(repository, 'commit');

        expect(set.write('s1', rows('QB', 'RB'))).toBe(0);
        expect(spy.mock.calls.filter(([c]) => c === COLLECTION)).toHaveLength(0);
        spy.mockRestore();
    });

    it('writes only the document that moved', () => {
        set.write('s1', rows('QB', 'RB', 'WR'));
        const changed = [...rows('QB', 'RB', 'WR')];
        changed[1] = { ...changed[1], label: 'RB1' };

        expect(set.write('s1', changed)).toBe(1);
        expect(set.read('s1').find(r => r.rowId === 'RB').label).toBe('RB1');
    });

    it('removes what is no longer in the list', () => {
        set.write('s1', rows('QB', 'RB', 'WR'));
        // Dropping the LAST one leaves every other document untouched, so the
        // deletion is the only change.
        expect(set.write('s1', rows('QB', 'RB'))).toBe(1);

        const left = set.read('s1').map(r => r.rowId);
        expect(left).toEqual(expect.arrayContaining(['QB', 'RB']));
        expect(left).not.toContain('WR');
    });

    it('rewrites the rows after one removed from the middle, because order is stored', () => {
        // Not a flaw, a consequence worth knowing: position in the list is part
        // of the document, so taking a row out of the middle moves everything
        // below it. Removing RB is one deletion plus one row that really did
        // change. It is still bounded by what moved, which is the point.
        set.write('s1', rows('QB', 'RB', 'WR'));
        expect(set.write('s1', rows('QB', 'WR'))).toBe(2);

        const left = set.read('s1').map(r => r.rowId);
        expect(left).not.toContain('RB');
        expect(left).toEqual(expect.arrayContaining(['QB', 'WR']));
    });

    it('keeps the first of two items claiming one id', () => {
        const dupes = [{ rowId: 'QB', label: 'first' }, { rowId: 'QB', label: 'second' }];
        set.write('s1', dupes);
        expect(set.read('s1')).toHaveLength(1);
        expect(set.read('s1')[0].label).toBe('first');
    });

    it('does not store the id inside the document as well as in the key', () => {
        set.write('s1', rows('QB'));
        const stored = repository.get(COLLECTION, 's1__QB');
        expect(stored.id).toBeUndefined();
    });

    it('keeps one scope out of another', () => {
        set.write('s1', rows('QB', 'RB'));
        set.write('s2', rows('WR'));

        expect(set.read('s1')).toHaveLength(2);
        expect(set.read('s2')).toHaveLength(1);

        // And emptying one leaves the other alone.
        set.write('s1', []);
        expect(set.read('s1')).toHaveLength(0);
        expect(set.read('s2')).toHaveLength(1);
    });

    it('drops a whole scope, and only that scope', async () => {
        set.write('s1', rows('QB', 'RB'));
        set.write('s2', rows('WR'));

        await set.removeAll('s1');
        expect(set.has('s1')).toBe(false);
        expect(set.has('s2')).toBe(true);
    });

    it('reports an empty scope as empty rather than missing', () => {
        expect(set.has('never_written')).toBe(false);
        expect(set.read('never_written')).toEqual([]);
    });
});
