/**
 * Which store the app is talking to.
 *
 * One build, several backends, chosen at build time because this is a static
 * site with no server to ask. `VITE_BACKEND` picks the adapter and everything
 * above it — the repository, the stores, every view — is unchanged.
 *
 *   local   the browser's own localStorage. The default, and what the app
 *           has always been.
 *   memory  nothing is persisted. Useful for a demo, and the adapter that
 *           proves the seam is real — see memoryAdapter.js.
 *   firebase  Firestore underneath, with this browser overlaid on top — see
 *           overlayAdapter.js. Everyone reads the experts' work; an expert
 *           writes to it and everybody else writes over it, locally. Which
 *           of those happens is decided by auth, and enforced by
 *           firestore.rules rather than here.
 *
 * An HTTP backend lands here as one more case. It is absent rather than
 * stubbed: a case that throws is honest, and an import of a library that is
 * not installed is not.
 *
 * Unknown values fall back to local with a warning rather than failing to
 * start. A typo in an environment variable should not produce a white page.
 */
import { localAdapter } from './localAdapter';
import { createMemoryAdapter } from './memoryAdapter';
import { createFirebaseAdapter } from './firebaseAdapter';
import { createOverlayAdapter } from './overlayAdapter';
import { isExpert } from '../utils/auth';

export const BACKENDS = ['local', 'memory', 'firebase'];

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
        case 'firebase': return createOverlayAdapter({
            remote: createFirebaseAdapter(),
            local: localAdapter,
            // Asked on every write rather than captured once: signing in is
            // something that happens while the app is running, and a captured
            // answer would keep an expert writing locally for the rest of the
            // session.
            writesRemote: isExpert,
            onRemoteError: (path, err) => {
                console.warn(`Could not read ${path} from the shared store.`, err?.code ?? err);
            },
        });
        case 'memory': return createMemoryAdapter();
        case 'local':
        default: return localAdapter;
    }
}
