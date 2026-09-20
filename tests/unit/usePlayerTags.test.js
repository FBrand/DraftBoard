import { describe, it, expect } from 'vitest';
import { loadTagIndex, tagFor } from '../../src/hooks/usePlayerTags.js';

// This hook runs once per rendered card on the Draft/UDFA board — a
// render-loop path, not a click handler. loadTagIndex/tagFor are plain
// functions specifically so that's testable without rendering anything.
describe('usePlayerTags — id-first lookup for a render-loop path', () => {
    const entries = [
        { playerId: 'p1', name: 'Diego Pounds', position: 'OT', tag: 'like' },
        { playerId: 'p2', name: 'Diego Pounds', position: 'DT', tag: 'avoid' },
        { name: 'No Id Yet', position: 'WR', tag: 'monitor' },
    ];
    const loaded = loadTagIndex(entries);

    it('an id qualifier hits directly, even with two same-named entries', () => {
        expect(tagFor('Diego Pounds', { id: 'p2' }, loaded)).toBe('avoid');
        expect(tagFor('Diego Pounds', { id: 'p1' }, loaded)).toBe('like');
    });

    it('falls back to a qualified name match for an entry with no id yet', () => {
        expect(tagFor('No Id Yet', { position: 'WR' }, loaded)).toBe('monitor');
    });

    it('falls back to a qualified name match when the qualifier has no id', () => {
        expect(tagFor('Diego Pounds', { position: 'DT' }, loaded)).toBe('avoid');
    });

    it('returns null rather than guessing for an unknown player', () => {
        expect(tagFor('Nobody Here', { id: 'p9' }, loaded)).toBeNull();
    });

    it('returns null outright for an empty board', () => {
        expect(tagFor('Diego Pounds', { id: 'p1' }, loadTagIndex([]))).toBeNull();
    });
});
