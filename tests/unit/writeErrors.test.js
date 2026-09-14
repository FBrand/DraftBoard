import { describe, it, expect } from 'vitest';
import { classifyWriteError } from '../../src/data/writeErrors';

/**
 * Whether trying again could possibly help.
 *
 * The queue used to treat every refusal the same: five attempts, widening
 * gaps, then give up. Right for a connection that is down, wrong for a write
 * the store has judged and rejected — four more attempts at a permission error
 * achieve nothing except burying the reason under "retrying", which is the one
 * word that tells somebody to sit and wait.
 */
const withCode = (code) => Object.assign(new Error(code), { code });

describe('a store that could not be reached', () => {
    it('is worth trying again', () => {
        ['unavailable', 'deadline-exceeded', 'internal', 'cancelled'].forEach(code => {
            expect(classifyWriteError(withCode(code)).permanent).toBe(false);
        });
    });

    it('treats rate limiting as transient, because backing off IS the remedy', () => {
        expect(classifyWriteError(withCode('resource-exhausted')).permanent).toBe(false);
    });
});

describe('a store that judged the write and said no', () => {
    it('stops, rather than asking four more times', () => {
        ['permission-denied', 'invalid-argument', 'failed-precondition', 'out-of-range']
            .forEach(code => expect(classifyWriteError(withCode(code)).permanent).toBe(true));
    });

    it('says what to do about a rule rejection, not just that one happened', () => {
        const out = classifyWriteError(withCode('permission-denied'));
        expect(out.advice).toMatch(/Sign in|board of your own/);
    });

    it('treats a signed-out write as permanent until somebody signs in', () => {
        expect(classifyWriteError(withCode('unauthenticated')).permanent).toBe(true);
    });
});

describe('running out of space', () => {
    // Permanent by this test, which reads oddly and is right: nothing the app
    // can do makes room, so retrying in eight seconds is a lie. What resolves
    // it is a person exporting and clearing.
    it('is recognised however the browser spells it', () => {
        expect(classifyWriteError(Object.assign(new Error('x'), { name: 'QuotaExceededError' })).permanent).toBe(true);
        expect(classifyWriteError(Object.assign(new Error('x'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' })).permanent).toBe(true);
        expect(classifyWriteError(Object.assign(new Error('x'), { code: 22 })).permanent).toBe(true);
        expect(classifyWriteError(new Error('quota simulated')).permanent).toBe(true);
    });

    it('says to export and clear, which is the only thing that works', () => {
        const out = classifyWriteError(Object.assign(new Error('x'), { name: 'QuotaExceededError' }));
        expect(out.reason).toBe('out-of-space');
        expect(out.advice).toMatch(/file/);
    });
});

describe('a failure nobody recognises', () => {
    it('is treated as transient on purpose', () => {
        // Guessing "permanent" on something unknown stops the app trying on
        // what may well be a blip. Guessing "transient" costs a few retries.
        expect(classifyWriteError(new Error('who knows')).permanent).toBe(false);
        expect(classifyWriteError(undefined).permanent).toBe(false);
    });
});
