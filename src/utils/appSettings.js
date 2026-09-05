/**
 * Settings that belong to the tool rather than to any one board.
 *
 * Positional value is the clearest case. It decides the order of players
 * nobody has explicitly placed, so it was quietly shaping every board from a
 * hardcoded list in boardRanking.js — RGR's view of what a position is worth,
 * baked into code where nobody could see or change it. It is an opinion, and
 * opinions belong somewhere they can be edited.
 *
 * It is deliberately GLOBAL rather than per board. Positional value is how
 * this tool breaks ties when an analyst hasn't spoken; if Dan and Ryan
 * genuinely disagree about what a running back is worth, that disagreement
 * belongs in where they place players, not in a hidden default that makes
 * their untouched boards differ for reasons neither of them chose.
 */
import { safeHttpUrl, ATHLETIC_MATRIX_URL_KEY } from './appLinks';

const POSITION_VALUE_KEY = 'position_value_v1';

/** The order shipped with the app, most valuable first. */
export const DEFAULT_POSITION_VALUE = [
    'QB', 'EDGE', 'OT', 'WR', 'CB', 'DL', 'S', 'TE', 'LB', 'IOL', 'RB', 'FB', 'K', 'P', 'LS',
];

// Read on every ranking pass, so it is cached rather than re-parsed per call.
// Invalidated on write, which is the only thing that can change it.
let cached = null;

function parseList(raw) {
    return String(raw ?? '')
        .split(/[\s,]+/)
        .map(p => p.trim().toUpperCase())
        .filter(Boolean);
}

export function getPositionValue() {
    if (cached) return cached;
    try {
        const stored = JSON.parse(localStorage.getItem(POSITION_VALUE_KEY) || 'null');
        if (Array.isArray(stored) && stored.length) {
            cached = stored.map(p => String(p).toUpperCase());
            return cached;
        }
    } catch { /* ignore */ }
    cached = DEFAULT_POSITION_VALUE;
    return cached;
}

/**
 * Replaces the order. Accepts a list or a comma/space separated string, so the
 * settings field can be a single text box rather than fifteen inputs.
 * Anything empty resets to the shipped order.
 */
export function setPositionValue(value) {
    const list = Array.isArray(value) ? value.map(p => String(p).toUpperCase()) : parseList(value);
    cached = null;
    try {
        if (!list.length) localStorage.removeItem(POSITION_VALUE_KEY);
        else localStorage.setItem(POSITION_VALUE_KEY, JSON.stringify(list));
    } catch { /* ignore */ }
    return getPositionValue();
}

export function isPositionValueCustom() {
    return getPositionValue() !== DEFAULT_POSITION_VALUE;
}

/**
 * The Athletic Matrix store page credited on scouting cards. Already
 * overridable by `?matrixUrl=` and by build-time env; this is the same value,
 * settable from the app rather than only from a link somebody has to know to
 * construct.
 */
export function setAthleticMatrixUrl(value) {
    const url = safeHttpUrl(value);
    try {
        if (!value || !String(value).trim()) localStorage.removeItem(ATHLETIC_MATRIX_URL_KEY);
        else if (url) localStorage.setItem(ATHLETIC_MATRIX_URL_KEY, url);
    } catch { /* ignore */ }
    // Reports back what was rejected, so the caller can say so rather than
    // silently keeping the old value.
    return { ok: !String(value ?? '').trim() || !!url, url };
}
