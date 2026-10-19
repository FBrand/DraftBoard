import { describe, it, expect, beforeEach } from 'vitest';
import { safeHttpUrl, getAthleticMatrixUrl, ATHLETIC_MATRIX_URL_KEY } from '../../src/utils/appLinks';
import {
    getPositionValue, setPositionValue, isPositionValueCustom, DEFAULT_POSITION_VALUE,
    getRoundSizes, setRoundSizes, getRoundEnds, getLastDraftPick,
    getSessionTeam, setSessionTeam, setAthleticMatrixUrl,
} from '../../src/utils/appSettings';

/**
 * Settings and the configurable link.
 *
 * Replaces `settings.spec.js` ("positional value is editable and reaches the
 * board", "the shipped order can be restored", "a link that is not http is
 * refused rather than stored", "a valid link is kept") and the link half of
 * `scouting-params.spec.js` ("?matrixUrl= overrides the link and is
 * remembered", "rejects a non-http scheme rather than putting it in the
 * href").
 *
 * The URL validation is the part with teeth. These values end up in an href
 * and one source is a query parameter, so an unchecked value is a script
 * injection dressed up as configuration.
 */
const withSearch = (search) => {
    globalThis.window = { location: { search } };
};

beforeEach(() => {
    globalThis.resetStorage();
    withSearch('');
});

describe('which URLs are allowed near an href', () => {
    it('takes http and https', () => {
        expect(safeHttpUrl('https://example.com/matrix')).toBe('https://example.com/matrix');
        expect(safeHttpUrl('http://example.com/matrix')).toBe('http://example.com/matrix');
    });

    it('refuses javascript:, which is the whole reason this exists', () => {
        expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    });

    it('refuses other schemes and things that are not URLs at all', () => {
        ['data:text/html,<script>', 'file:///etc/passwd', 'ftp://example.com', 'example.com', '', null, 42]
            .forEach(bad => expect(safeHttpUrl(bad)).toBeNull());
    });
});

describe('the Athletic Matrix link', () => {
    it('is overridden by ?matrixUrl=, and remembered so later pages keep it', () => {
        withSearch('?matrixUrl=https://store.example.com/matrix');

        expect(getAthleticMatrixUrl()).toBe('https://store.example.com/matrix');
        expect(localStorage.getItem(ATHLETIC_MATRIX_URL_KEY)).toBe('https://store.example.com/matrix');

        // And it survives the parameter falling off the next link.
        withSearch('');
        expect(getAthleticMatrixUrl()).toBe('https://store.example.com/matrix');
    });

    it('ignores a hostile scheme in the parameter rather than storing it', () => {
        withSearch('?matrixUrl=javascript:alert(1)');
        getAthleticMatrixUrl();
        expect(localStorage.getItem(ATHLETIC_MATRIX_URL_KEY)).toBeNull();
    });

    it('is settable from the app, and says what it rejected', () => {
        expect(setAthleticMatrixUrl('https://store.example.com/x')).toEqual({
            ok: true, url: 'https://store.example.com/x',
        });
        expect(localStorage.getItem(ATHLETIC_MATRIX_URL_KEY)).toBe('https://store.example.com/x');

        const bad = setAthleticMatrixUrl('javascript:alert(1)');
        expect(bad.ok).toBe(false);
        // and the good one is still there, not replaced by the bad one
        expect(localStorage.getItem(ATHLETIC_MATRIX_URL_KEY)).toBe('https://store.example.com/x');
    });

    it('treats an emptied box as clearing it, which is not an error', () => {
        setAthleticMatrixUrl('https://store.example.com/x');
        expect(setAthleticMatrixUrl('   ').ok).toBe(true);
        expect(localStorage.getItem(ATHLETIC_MATRIX_URL_KEY)).toBeNull();
    });
});

describe('positional value', () => {
    it('ships with an order and reports it as not customised', () => {
        expect(getPositionValue()).toEqual(DEFAULT_POSITION_VALUE);
        expect(isPositionValueCustom()).toBe(false);
    });

    it('takes a new order and remembers it', () => {
        setPositionValue('QB, EDGE, WR');
        expect(getPositionValue()).toEqual(['QB', 'EDGE', 'WR']);
        expect(isPositionValueCustom()).toBe(true);
    });

    it('takes a list as readily as a typed string, and upper-cases either', () => {
        setPositionValue(['qb', 'edge']);
        expect(getPositionValue()).toEqual(['QB', 'EDGE']);
    });

    it('restores the shipped order when emptied', () => {
        setPositionValue('QB, EDGE');
        setPositionValue('');
        expect(getPositionValue()).toEqual(DEFAULT_POSITION_VALUE);
        expect(isPositionValueCustom()).toBe(false);
    });
});

describe('round sizes, which everything about rounds is read off', () => {
    it('defaults to the real 2026 order', () => {
        expect(getRoundSizes()).toEqual([32, 32, 36, 40, 41, 35, 41]);
        expect(getLastDraftPick()).toBe(257);
    });

    it('turns sizes into the boundaries a pick is looked up in', () => {
        setRoundSizes([2, 2, 2]);
        expect(getRoundEnds()).toEqual([2, 4, 6]);
        expect(getLastDraftPick()).toBe(6);
    });

    it('restores the shipped sizes when emptied', () => {
        setRoundSizes([2, 2]);
        setRoundSizes('');
        expect(getRoundSizes()).toEqual([32, 32, 36, 40, 41, 35, 41]);
    });
});

describe('whose offseason this is', () => {
    it('defaults to the configured team and is settable', () => {
        expect(getSessionTeam()).toBeTruthy();
        setSessionTeam('SF');
        expect(getSessionTeam()).toBe('SF');
    });
});
