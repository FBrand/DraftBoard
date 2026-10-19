import { describe, it, expect, vi, afterEach } from 'vitest';
import { shortId, prefixedId, randomBase36 } from '../../src/utils/ids';

/**
 * Ids short enough to be worth storing, unique because they are checked.
 *
 * Eight base36 characters generated blind is roughly one collision in 25,000
 * across 15,000 players. That is not a rounding error: a collision merges two
 * people, which is the failure the registry exists to prevent. So the length is
 * the budget and the check is the guarantee.
 */
const SHAPE = /^[pbsa]_[0-9a-z]{8}$/;

afterEach(() => { vi.unstubAllGlobals(); });

describe('shape', () => {
    it('is a one-letter kind and eight base36 characters', () => {
        for (let i = 0; i < 200; i += 1) expect(shortId('p')).toMatch(SHAPE);
        expect(shortId('b')).toMatch(/^b_/);
        expect(prefixedId('s')).toMatch(/^s_/);
    });

    it('uses the whole alphabet, not a biased slice of it', () => {
        // Bytes are rejected above 252 rather than taken modulo 36, which would
        // make 0-3 fractionally likelier. Nobody would notice; it is two lines.
        const seen = new Set(randomBase36(20000).split(''));
        expect(seen.size).toBe(36);
    });
});

describe('uniqueness', () => {
    it('does not repeat itself over a large run', () => {
        const seen = new Set();
        for (let i = 0; i < 20000; i += 1) seen.add(shortId('p'));
        expect(seen.size).toBe(20000);
    });

    it('never returns an id the caller already holds', () => {
        // The guarantee. Given a set containing every id it would produce,
        // it must not hand one back.
        const taken = new Set();
        for (let i = 0; i < 5000; i += 1) taken.add(shortId('p', taken));
        expect(taken.size).toBe(5000);

        const fresh = shortId('p', taken);
        expect(taken.has(fresh)).toBe(false);
    });

    it('gives up on being short before it gives up on being unique', () => {
        // A jammed entropy source: every attempt collides. Length is the thing
        // to sacrifice.
        const only = 'p_aaaaaaaa';
        vi.stubGlobal('crypto', {
            getRandomValues: (b) => { b.fill(10); return b; },   // 10 -> 'a'
        });
        const taken = new Set([only]);
        const id = shortId('p', taken);

        expect(id).not.toBe(only);
        expect(id.length).toBeGreaterThan(only.length);
    });
});

describe('where it gets its randomness', () => {
    it('works with no randomUUID at all, which is the plain-HTTP case', () => {
        // getRandomValues has no secure-context restriction; randomUUID does,
        // and this app is served over plain HTTP on a LAN address.
        vi.stubGlobal('crypto', {
            getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
        });
        expect(globalThis.crypto.randomUUID).toBeUndefined();
        expect(shortId('p')).toMatch(SHAPE);
    });

    it('still produces an id where there is no Web Crypto whatsoever', () => {
        vi.stubGlobal('crypto', undefined);
        expect(shortId('p')).toMatch(SHAPE);
    });
});
