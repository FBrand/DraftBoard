import { describe, it, expect, vi, afterEach } from 'vitest';
import { uuid, prefixedId } from '../../src/utils/ids';

/**
 * Ids that are uuids wherever the app is served from.
 *
 * `crypto.randomUUID()` exists only in a secure context — HTTPS or localhost.
 * This app is routinely reached at a LAN address over plain HTTP, where the
 * method is simply absent, so every id fell through to a timestamp-and-random
 * fallback: `p_mu1pj3za48y4e6o7` in production, a real uuid in development,
 * from the same build, with nothing saying so.
 */
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => { vi.unstubAllGlobals(); });

describe('uuid', () => {
    it('is a canonical v4 — version nibble and variant bits both set', () => {
        for (let i = 0; i < 200; i += 1) expect(uuid()).toMatch(V4);
    });

    it('does not repeat itself', () => {
        const seen = new Set();
        for (let i = 0; i < 2000; i += 1) seen.add(uuid());
        expect(seen.size).toBe(2000);
    });

    it('works with no randomUUID at all, which is the plain-HTTP case', () => {
        // getRandomValues has no secure-context restriction; randomUUID does.
        vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
        expect(globalThis.crypto.randomUUID).toBeUndefined();
        expect(uuid()).toMatch(V4);
    });

    it('still produces a uuid where there is no Web Crypto whatsoever', () => {
        vi.stubGlobal('crypto', undefined);
        expect(uuid()).toMatch(V4);
    });
});

describe('prefixedId', () => {
    it('says what kind of thing it names, then the uuid', () => {
        expect(prefixedId('p')).toMatch(/^p_/);
        expect(prefixedId('b').slice(2)).toMatch(V4);
    });
});
