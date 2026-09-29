import { describe, it, expect, beforeEach } from 'vitest';
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
