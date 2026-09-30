import { describe, it, expect, beforeEach, vi } from 'vitest';
import { repository } from '../../src/data/repository';
import {
    DRAFT_STATE, draftScope, draftLead, iAmLead, claimLead, releaseLead,
    writeDraft, readDraft, openDraft,
} from '../../src/data/draftStore';

/**
 * The live draft has one writer, and holding it survives using it.
 *
 * The lead lives on the draft document itself, so the rules can read it for
 * free rather than paying a lookup on every one of ~300 pick writes. The cost
 * of that choice is the thing worth testing: every write to the draft rewrites
 * the document, and the obvious implementation drops the field it is not
 * thinking about — so the holder would release the lead by making a pick.
 */
const SEASON = 's_lead_test';
const me = () => repository.identity();

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openDraft();
});

describe('holding the live draft', () => {
    it('is nobody’s until somebody claims it', () => {
        expect(draftLead(SEASON)).toBeNull();
        expect(iAmLead(SEASON)).toBe(false);
    });

    it('is mine once I claim it', () => {
        expect(claimLead(SEASON)).toBe(true);
        expect(draftLead(SEASON)).toBe(me());
        expect(iAmLead(SEASON)).toBe(true);
    });

    it('survives writing the draft, which is the whole point of using it', () => {
        claimLead(SEASON);
        writeDraft(SEASON, { currentPick: 12, ourPicksLeft: [31] });

        expect(draftLead(SEASON)).toBe(me());
        expect(readDraft(SEASON)?.currentPick).toBe(12);
    });

    it('does not throw away the draft when it is claimed', () => {
        // Claiming merges into the document the picks live in. Replacing it
        // would lose the draft at the moment somebody takes charge of it.
        writeDraft(SEASON, { currentPick: 40, ourPicksLeft: [] });
        claimLead(SEASON);

        expect(readDraft(SEASON)?.currentPick).toBe(40);
        expect(iAmLead(SEASON)).toBe(true);
    });

    it('is given up without disturbing the picks', () => {
        claimLead(SEASON);
        writeDraft(SEASON, { currentPick: 7, ourPicksLeft: [] });

        expect(releaseLead(SEASON)).toBe(true);
        expect(draftLead(SEASON)).toBeNull();
        // Releasing leaves the picks where they are: the role owns the live
        // draft, not its history, and whoever claims next continues from here.
        expect(readDraft(SEASON)?.currentPick).toBe(7);
    });

    it('cannot be released by somebody who does not hold it', () => {
        // Simulated by planting another holder, since a local build has one
        // identity: the guard is the comparison, not the environment.
        repository.set(DRAFT_STATE, draftScope(SEASON), { o: 'somebody-else', value: { currentPick: 3 } });

        expect(iAmLead(SEASON)).toBe(false);
        expect(releaseLead(SEASON)).toBe(false);
        expect(draftLead(SEASON)).toBe('somebody-else');
    });

    it('cannot be claimed while somebody else holds it', () => {
        repository.set(DRAFT_STATE, draftScope(SEASON), { o: 'somebody-else', value: {} });

        expect(claimLead(SEASON)).toBe(false);
        expect(draftLead(SEASON)).toBe('somebody-else');
    });

    it('is idempotent for the holder', () => {
        claimLead(SEASON);
        expect(claimLead(SEASON)).toBe(true);
        expect(draftLead(SEASON)).toBe(me());
    });
});

/**
 * Two tabs, one expert, and neither of them writing the other's work away.
 *
 * The lead is one uid, not one session, so both tabs answer `iAmLead` true and
 * both write the draft. That is fine — they are the same person — as long as
 * neither writes the DOCUMENT whole from its own cache: the loser's copy never
 * saw the winner's picks, and a stale `o` written back is refused outright by the
 * rules, taking the write with it.
 *
 * The same whole-record-from-cache pattern was removed from boardEntries one
 * commit before it was reintroduced here.
 */
describe('two writers of one draft', () => {
    it('names the field it changes, so a stale cache cannot carry the lead back', () => {
        claimLead(SEASON);

        const calls = [];
        const spy = vi.spyOn(repository, 'commitMany').mockImplementation((items) => {
            calls.push(...items);
            return Promise.resolve([]);
        });

        writeDraft(SEASON, { currentPick: 30, ourPicksLeft: [] });

        const draftWrite = calls.find(c => c.collection === DRAFT_STATE);
        expect(draftWrite).toBeTruthy();
        expect(Object.keys(draftWrite.doc)).toEqual(['value']);
        expect(draftWrite.merge).toBe(true);
        spy.mockRestore();
    });

    it('claims by naming the lead, not by rewriting the picks', () => {
        writeDraft(SEASON, { currentPick: 55, ourPicksLeft: [] });

        const calls = [];
        const spy = vi.spyOn(repository, 'commitMany').mockImplementation((items) => {
            calls.push(...items);
            return Promise.resolve([]);
        });

        claimLead(SEASON);

        const [claim] = calls.filter(c => c.collection === DRAFT_STATE);
        expect(Object.keys(claim.doc)).toEqual(['o']);
        expect(claim.merge).toBe(true);
        spy.mockRestore();
    });
});
