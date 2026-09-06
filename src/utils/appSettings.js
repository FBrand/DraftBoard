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
import { TEAM_CONFIG, DEFAULT_ROUND_SIZES } from '../constants';

const POSITION_VALUE_KEY = 'position_value_v1';
const TEAM_KEY = 'session_team_v1';
const ROUND_SIZES_KEY = 'round_sizes_v1';

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
 * How many picks each round of this draft has.
 *
 * Compensatory picks make the rounds uneven and move them year to year, so
 * this is something an expert states rather than something the app derives.
 * Everything about rounds — which round a pick belongs to, where the draft
 * ends, whether a signing is undrafted — is read off it.
 */
export function getRoundSizes() {
    try {
        const stored = JSON.parse(localStorage.getItem(ROUND_SIZES_KEY) || 'null');
        if (Array.isArray(stored) && stored.length && stored.every(n => Number.isFinite(n) && n > 0)) {
            return stored;
        }
    } catch { /* ignore */ }
    return DEFAULT_ROUND_SIZES;
}

/** Accepts a list or a comma/space separated string. Empty resets. */
export function setRoundSizes(value) {
    const list = (Array.isArray(value) ? value : String(value ?? '').split(/[\s,]+/))
        .map(n => parseInt(n, 10))
        .filter(n => Number.isFinite(n) && n > 0);
    try {
        if (!list.length) localStorage.removeItem(ROUND_SIZES_KEY);
        else localStorage.setItem(ROUND_SIZES_KEY, JSON.stringify(list));
    } catch { /* ignore */ }
    return getRoundSizes();
}

/** The last overall pick of each round — the running total of the sizes. */
export function getRoundEnds() {
    let total = 0;
    return getRoundSizes().map(n => (total += n));
}

/** The final pick of the draft. Anything after it is a signing. */
export function getLastDraftPick() {
    const ends = getRoundEnds();
    return ends[ends.length - 1] ?? 0;
}

/**
 * Whose offseason this session is. Everyone on the roster plays for them,
 * everyone drafted here is drafted by them, and a free-agent candidate is
 * somebody they might sign.
 *
 * It defaults to the team the app is branded for, and is a setting rather than
 * a constant because the tool is data-driven — the same build runs somebody
 * else's offseason with a different rankings file and a different roster.
 */
export function getSessionTeam() {
    try {
        const stored = localStorage.getItem(TEAM_KEY);
        if (stored && stored.trim()) return stored.trim().toUpperCase();
    } catch { /* ignore */ }
    return TEAM_CONFIG.abbreviation;
}

export function setSessionTeam(value) {
    const team = String(value ?? '').trim().toUpperCase();
    try {
        if (!team) localStorage.removeItem(TEAM_KEY);
        else localStorage.setItem(TEAM_KEY, team);
    } catch { /* ignore */ }
    return getSessionTeam();
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
