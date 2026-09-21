/**
 * The two joins a draft reconciliation actually needs, as a pure function.
 *
 * Pulled out of useDraftState.js on purpose: that hook has module-level
 * side effects (two `new Audio()` calls) that make it uninstantiable in a
 * plain Node test, so anything meant to be unit-tested in isolation has to
 * live somewhere without them.
 *
 * `pool` must already carry a registry `id` on every player that has one —
 * see the `resolveAll()` call in useDraftState.js's `loadInitialData`.
 * Without that, both joins below fall through to a full fuzzy scan every
 * time regardless of which side iterates: `pool` comes from a rankings CSV
 * and never has an id of its own, so an id-first join against it can only
 * ever fire once the pool itself has been resolved against the registry,
 * once, up front. That resolution is the expensive part of a cold start (a
 * name-index scan per player); re-running it per live pick would be the
 * same mistake this function exists to avoid, just moved one step earlier.
 * Once the pool is resolved, both joins below are id lookups for anyone
 * already known and a fuzzy scan only for a genuine stranger to this
 * rankings file — cheap enough to re-run on every remote snapshot, which is
 * the whole point: this is what makes live sync possible without freezing
 * the draft board on every pick.
 *
 * `savedDrafted` is `draftStore.readDraft()`'s `draftedPlayers` — already
 * carries a real registry `playerId` on every entry, since it is built
 * straight from registry records (see `draftStore.js`'s `asPick`).
 *
 * No side effects. `recordDraftFacts` (which writes to the registry) and
 * `setCurrentPick`'s cold-start derivation are deliberately NOT here — see
 * useDraftState.js's two call sites for why each has to stay separate.
 */
import { joinIndex, findJoin } from './pickJoin';
import { getSessionTeam } from './appSettings';

const isOurs = (team) => !!team && String(team).toUpperCase() === getSessionTeam();

export function reconcileDraft(pool, savedDrafted) {
    const savedDraftedIndex = joinIndex(savedDrafted);
    const reconciledPlayers = pool.map(p => {
        const matchIdx = findJoin(p, savedDraftedIndex);
        if (matchIdx === -1) return p;
        const match = savedDrafted[matchIdx];
        return {
            ...p,
            drafted: true,
            pickNumber: match.pickNumber,
            team: match.team,
            // Who MADE the pick, not whose list the number was on. picks.txt
            // is what we owned going in; the draft file is what happened
            // after trades, and they differ for five of nine picks in the
            // shipped season — so Spencer Fano, taken 9th by Cleveland,
            // painted as a Chief.
            draftedByUs: isOurs(match.team),
        };
    });

    // NOTE: use sd.draftedByUs (persisted value) — an undrafted signing with
    // no club yet has nothing else to fall back on.
    const poolIndex = joinIndex(pool);
    const enrichedDrafted = savedDrafted.map(sd => {
        const matchIdx = findJoin(sd, poolIndex);
        const draftedByUs = sd.team ? isOurs(sd.team) : sd.draftedByUs === true;
        if (matchIdx === -1) return { ...sd, draftedByUs };
        const updatedMetadata = pool[matchIdx];
        return {
            ...updatedMetadata,
            playerId: sd.playerId ?? updatedMetadata.id ?? null,
            pickNumber: sd.pickNumber,
            team: sd.team,
            drafted: true,
            draftedByUs,
        };
    });

    return { players: reconciledPlayers, draftedPlayers: enrichedDrafted };
}
