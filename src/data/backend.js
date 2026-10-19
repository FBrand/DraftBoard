/**
 * Which store the app is talking to.
 *
 * One build, two backends, chosen at build time because this is a static site
 * with no server to ask. `VITE_BACKEND` picks the adapter and everything above
 * it — the repository, the stores, every view — is unchanged.
 *
 *   local   the browser's own localStorage. The default, and what the app
 *           has always been.
 *   memory  nothing is persisted. Useful for a demo, and the adapter that
 *           proves the seam is real — see memoryAdapter.js. It deliberately
 *           has no `loadSync`, which is what forces callers onto `ready()`
 *           instead of silently reading nothing.
 *
 * A shared backend lands here as one more case. It is absent rather than
 * stubbed: a case that throws is honest, and an import of a library that is
 * not installed is not. That work lives on the `firebase` branch and is
 * deliberately not on this one.
 *
 * Unknown values fall back to local with a warning rather than failing to
 * start. A typo in an environment variable should not produce a white page.
 */
import { localAdapter } from './localAdapter';
import { createMemoryAdapter } from './memoryAdapter';

export const BACKENDS = ['local', 'memory'];

export function backendName() {
    const asked = String(import.meta.env?.VITE_BACKEND ?? 'local').trim().toLowerCase();
    if (BACKENDS.includes(asked)) return asked;
    if (asked) {
        console.warn(`VITE_BACKEND="${asked}" is not one of ${BACKENDS.join(', ')} — using local.`);
    }
    return 'local';
}

export function createAdapter(name = backendName()) {
    switch (name) {
        case 'memory': return createMemoryAdapter();
        case 'local':
        default: return localAdapter;
    }
}
