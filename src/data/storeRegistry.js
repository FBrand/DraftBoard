/**
 * Somewhere a test can reset every store from, importing nothing.
 *
 * The suite's setup file cannot import `appStore` to call its reset: appStore
 * reaches the repository, which reaches `backend`, which reaches
 * `firebaseAdapter` — and the adapter test mocks `firebase/firestore` partially,
 * so pulling the real module into the graph first breaks it. `memoryAdapter`
 * carries a comment about exactly this, having been bitten by it already.
 *
 * So the stores register themselves here and the setup file imports only this,
 * which imports nothing at all.
 */
const resets = new Set();

/** Registers a reset. Returns a function that unregisters it. */
export function onReset(fn) {
    resets.add(fn);
    return () => resets.delete(fn);
}

/** Resets every registered store. Tests only. */
export function resetStores() {
    resets.forEach((fn) => { try { fn(); } catch { /* keep going */ } });
}
