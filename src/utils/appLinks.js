/**
 * Outbound links that a deployment might want to point somewhere else —
 * currently just the Athletic Matrix store page credited on scouting cards.
 *
 * Resolution order, first valid wins:
 *   1. `?matrixUrl=…` on the URL   (per-session override; also remembered)
 *   2. localStorage                 (what a previous override left behind)
 *   3. VITE_ATHLETIC_MATRIX_URL     (baked in at build time per deployment)
 *   4. the default below
 */

const DEFAULT_ATHLETIC_MATRIX_URL =
    'https://www.rogueapc.com/store/p21/The_2026_Athletic_Matrix.html';

export const ATHLETIC_MATRIX_URL_KEY = 'athletic_matrix_url';

/**
 * Only absolute http(s) URLs are accepted. These values end up in an `href`,
 * and one source is a query parameter — anyone can put `javascript:…` in a
 * link they send someone, so an unvalidated value here would be a script
 * injection dressed up as configuration.
 */
export function safeHttpUrl(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        const url = new URL(value.trim());
        return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
    } catch {
        return null;
    }
}

export function getAthleticMatrixUrl() {
    let fromParam = null;
    try {
        fromParam = safeHttpUrl(new URLSearchParams(window.location.search).get('matrixUrl'));
    } catch { /* no window/search — fall through */ }

    if (fromParam) {
        // Remembered so the override survives navigation within the app
        // without having to keep the parameter on every link.
        try { localStorage.setItem(ATHLETIC_MATRIX_URL_KEY, fromParam); } catch { /* ignore */ }
        return fromParam;
    }

    try {
        const stored = safeHttpUrl(localStorage.getItem(ATHLETIC_MATRIX_URL_KEY));
        if (stored) return stored;
    } catch { /* ignore */ }

    const fromEnv = safeHttpUrl(import.meta.env?.VITE_ATHLETIC_MATRIX_URL);
    if (fromEnv) return fromEnv;

    return DEFAULT_ATHLETIC_MATRIX_URL;
}
