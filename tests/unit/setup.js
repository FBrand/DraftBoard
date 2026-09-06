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
globalThis.resetStorage = () => { globalThis.localStorage = new MemoryStorage(); };
