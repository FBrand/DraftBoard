import { describe, it, expect, vi } from 'vitest';
import { createOverlayAdapter } from '../../src/data/overlayAdapter';
import { createRepository } from '../../src/data/repository';

/**
 * "Could not read" is not "nothing there".
 *
 * The overlay answers a failed remote read with the local half alone, on
 * purpose: a viewer is better served seeing his own work than a blank page, and
 * the shared boards are not his data to lose. That is right for rendering and
 * wrong for deciding, and one caller decides — `openBoards()` reads an empty
 * boards collection as "nobody has ever made one" and seeds a season from the
 * shipped CSVs.
 *
 * Which means a Firestore outage, a lapsed config, or a bad connection at the
 * wrong second would have every viewer seed a private board over the shared one
 * and then keep it, because the local overlay wins over the store. Found by
 * building the app with half its Firebase config: five collections failed, the
 * app reported a first run, and it looked exactly like one — the only trace was
 * a console warning per collection.
 */
const localStore = () => {
    const m = new Map();
    return {
        name: 'local',
        async load(p) { return { ...(m.get(p) ?? {}) }; },
        loadSync(p) { return { ...(m.get(p) ?? {}) }; },
        async set(p, id, doc) { m.set(p, { ...(m.get(p) ?? {}), [id]: doc }); },
        async remove(p, id) { const n = { ...(m.get(p) ?? {}) }; delete n[id]; m.set(p, n); },
    };
};

const remoteThatFails = (fail) => ({
    name: 'remote',
    async load(p) {
        if (fail()) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
        return { b_dan: { l: 'Dan' } };
    },
    async set() {}, async remove() {},
});

describe('a shared store that could not be reached', () => {
    it('is reported as a failed read, not as an empty collection', async () => {
        const onRemoteError = vi.fn();
        const adapter = createOverlayAdapter({
            remote: remoteThatFails(() => true),
            local: localStore(),
            writesRemote: () => false,
            onRemoteError,
        });
        const repo = createRepository(adapter);

        await repo.ready('boards');

        expect(repo.all('boards')).toHaveLength(0);   // still renders as empty
        expect(repo.loadFailed('boards')).toBe(true); // but says why
        expect(onRemoteError).toHaveBeenCalled();
    });

    it('retries on the next load rather than caching the failure', async () => {
        let broken = true;
        const adapter = createOverlayAdapter({
            remote: remoteThatFails(() => broken),
            local: localStore(),
            writesRemote: () => false,
        });
        const repo = createRepository(adapter);

        await repo.ready('boards');
        expect(repo.loadFailed('boards')).toBe(true);

        // A failed read must not count as "loaded", or the page never recovers.
        broken = false;
        repo.invalidate('boards');
        await repo.ready('boards');

        expect(repo.loadFailed('boards')).toBe(false);
        expect(repo.all('boards')).toHaveLength(1);
    });

    it('reports no failure once the store answers', async () => {
        const adapter = createOverlayAdapter({
            remote: remoteThatFails(() => false),
            local: localStore(),
            writesRemote: () => false,
        });
        const repo = createRepository(adapter);

        await repo.ready('boards');
        expect(repo.loadFailed('boards')).toBe(false);
        expect(repo.all('boards')).toHaveLength(1);
    });

    it('is always false for a store that cannot fail to be reached', async () => {
        const repo = createRepository(localStore());
        await repo.ready('boards');
        expect(repo.loadFailed('boards')).toBe(false);
    });
});
