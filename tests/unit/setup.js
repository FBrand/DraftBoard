import { resetMemoryAdapters } from '../../src/data/memoryAdapter';

/**
 * A localStorage good enough for the modules under test.
 *
 * Deliberately not happy-dom or jsdom: nothing here touches the DOM, only
 * storage. A twenty-line Map is faster to run, has no install cost, and
 * cannot drift from the real thing in ways that matter, because the only
 * surface used is get/set/remove/key/length.
 */
class MemoryStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(String(k), String(v)); }
    removeItem(k) { this.map.delete(k); }
    clear() { this.map.clear(); }
    key(i) { return [...this.map.keys()][i] ?? null; }
    get length() { return this.map.size; }
}

globalThis.localStorage = new MemoryStorage();

// Object.keys(localStorage) is used in places; back it with real properties.
//
// And the ADAPTER'S own store, which is a different place entirely. The suite
// runs on the memory adapter (see vitest.config.js), whose documents live in a
// Map inside it rather than in localStorage — so replacing localStorage leaves
// every board, draft and player from the previous test exactly where it was.
// Resetting one and not the other is worse than resetting neither, because the
// two then disagree: the cache is cleared and the store is not.
//
// A no-op when the config points at localAdapter, which keeps its documents IN
// localStorage and needs nothing more than the line above.
globalThis.resetStorage = () => {
    globalThis.localStorage = new MemoryStorage();
    resetMemoryAdapters();
};
