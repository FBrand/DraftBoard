/**
 * The draft as documents: one per selection.
 *
 * A draft was one value holding every pick made, rewritten on each one. Two
 * people running a draft together — which is the point of putting it on a
 * shared backend — are two whole-value writes racing, and the pick that lands
 * second wins with a copy that never saw the first. In a draft that is not a
 * lost edit, it is a lost player.
 *
 * So a selection is a document. Pick 21 is a document; making pick 22 does not
 * rewrite it. What is left over — whose turn it is, which picks you still own,
 * the board itself — stays as one small record, because those are single
 * values rather than a list anyone edits in parallel.
 */
import { createDocSet } from './docSet';
import { repository } from './repository';
import { nameKey } from '../utils/nameMatcher';
import { byId } from '../utils/playerRegistry';
import { getSessionTeam } from '../utils/appSettings';

export const DRAFT_PICKS = 'draft_picks';
export const DRAFT_STATE = 'draft_state';

export const draftScope = (seasonId) => `${seasonId ?? '_'}`;

const picks = createDocSet({
    collection: DRAFT_PICKS,
    /**
     * Filed under the PLAYER, not the slot.
     *
     * It used to be the pick number, which reads as the obvious key — a pick
     * is unique and numbered. But the number is what the document SAYS, and
     * keying a document on a field it also stores means correcting that field
     * writes a second document instead of the first one. Recording pick 41 as
     * pick 14 and fixing it left two picks and one player.
     *
     * A player is drafted once. Keying on him makes that a property of the
     * store rather than something the app has to remember, and it is the same
     * key the registry uses — which is what a backend needs, since it cannot
     * fuzzy-match ids server-side.
     *
     * Pre-registry rows have no playerId; they keep the old scheme so they are
     * still found, and pick up a real id the first time they are written.
     */
    idOf: (scope, p) => {
        if (p.playerId) return `${scope}__p_${p.playerId}`;
        const n = Number(p.pickNumber);
        if (Number.isFinite(n)) return `${scope}__pick_${n}`;
        return `${scope}__udfa_${nameKey(p.name)}`;
    },
    scopeOf: (doc, scope) => doc.scope === scope,
});

export function openDraft() {
    return Promise.all([repository.ready(DRAFT_PICKS), repository.ready(DRAFT_STATE)]);
}

export function hasDraft(seasonId) {
    const scope = draftScope(seasonId);
    return picks.has(scope) || !!repository.get(DRAFT_STATE, scope);
}

export function readDraft(seasonId) {
    const scope = draftScope(seasonId);
    const rest = repository.get(DRAFT_STATE, scope);
    if (!rest && !picks.has(scope)) return null;

    return {
        ...(rest?.value ?? {}),
        draftedPlayers: picks.read(scope).map(hydrate),
    };
}

/**
 * Puts back the two fields the document deliberately does not carry.
 *
 * `name` is the registry's, and storing a copy beside the id means a rename
 * fixes the player everywhere except the record of who was drafted. It is kept
 * on the document ONLY for a pick with no playerId — a pre-registry row, where
 * the name is the only identity there is.
 *
 * `draftedByUs` is not a fact about the pick at all. It is a comparison
 * between the pick's team and whose offseason this is, and storing the answer
 * meant it stayed true after the session team changed. An absent team is
 * "signed, no club yet" and is nobody's — never ours by default.
 */
function hydrate(p) {
    const record = p.playerId ? byId(p.playerId) : null;
    const team = p.team ?? null;
    return {
        ...p,
        name: record?.name ?? p.name ?? '',
        position: p.position ?? record?.position ?? '',
        draftedByUs: !!team && team === getSessionTeam(),
    };
}

/**
 * What is worth keeping, listed rather than inferred.
 *
 * The draft record used to be whatever the hook happened to be holding, spread
 * in — which meant it also stored `players`, the entire board, and
 * `yourPicks`, a second copy of the picks that were already there. Neither is
 * ever read back: the board is rebuilt from the rankings file reconciled with
 * the saved picks, and yourPicks is recomputed from them on load.
 *
 * That was 91KB per season of a 925KB budget, for nothing, in a store that
 * runs out at five megabytes — and the failure when it runs out is the app
 * refusing to save. A list rather than a rest-spread, so the next field added
 * to the hook does not quietly join it.
 */
const KEPT = ['currentPick', 'ourPicksLeft', 'remotePicks'];

/**
 * A pick, as a pick — not as a copy of the board player who was taken.
 *
 * It used to store the whole player: his school, his tier, his tag, his
 * position within the tier, his matrix scores, an empty remarks array, his
 * overall rank, and `drafted: true` on every document in a collection called
 * picks. 268 bytes to say four things.
 *
 * None of it was read back. On load each pick is matched against the rankings
 * file by name and re-enriched from it, so everything about the PLAYER comes
 * from the player; what must survive is what the draft did to him. The field
 * that looks missing is `round`, and it is derived — getRoundFromPick reads it
 * off the pick number, which was always the more truthful source anyway: the
 * stored round was the round somebody PROJECTED him in, which is how a player
 * who went undrafted came to have "R5" printed on his roster card.
 *
 * `position` stays because a pick can be somebody the current rankings file
 * has never heard of — a UDFA, or a player from another class — and then this
 * record is the only thing there is to show.
 *
 * `name` and `draftedByUs` are NOT stored. The name is the registry's, and a
 * copy of it beside the id is a second answer to "who is this" that a rename
 * leaves behind. `draftedByUs` is not about the pick — it compares the pick's
 * team to whose offseason this is, so storing the answer froze it against a
 * session team that can change. Both come back in `hydrate`.
 *
 * The stored round would be a fourth of this file's remaining bytes and is not
 * here either — but NOT because it can be derived. It cannot: compensatory
 * picks make ceil(pick/32) wrong from round three on, and the round sizes that
 * would fix it are a single global setting rather than one per season, so
 * reading a 2026 round off a 2027 draft is a real way to be confidently wrong.
 * The round is recorded on the PLAYER, by import or by hand, where it is a
 * fact about him rather than arithmetic on a slot. An earlier version of this
 * comment claimed the derivation was "the more truthful source"; it was wrong.
 *
 * The store does not have to look like the export. The export is rebuilt.
 */
const PICK_FIELDS = ['playerId', 'name', 'position', 'pickNumber', 'team'];

function leanPick(p) {
    const out = {};
    PICK_FIELDS.forEach(k => { if (p?.[k] !== undefined && p[k] !== null) out[k] = p[k]; });
    // The name is the registry's once there is an id to look it up by. Kept
    // only where there is no id, because then it is the only identity there is.
    if (out.playerId) delete out.name;
    return out;
}

export function writeDraft(seasonId, state) {
    const scope = draftScope(seasonId);
    const { draftedPlayers = [] } = state ?? {};
    const rest = {};
    KEPT.forEach(k => { if (state?.[k] !== undefined) rest[k] = state[k]; });

    picks.write(scope, draftedPlayers.map(leanPick));

    const id = scope;
    const before = repository.get(DRAFT_STATE, id);
    const next = { id, scope, value: rest };
    // The leftovers are small and change together; comparing them whole is
    // cheaper than diffing five fields, and they are not a concurrency
    // surface — whose turn it is has one answer.
    if (!before || JSON.stringify(before.value ?? {}) !== JSON.stringify(rest)) {
        repository.set(DRAFT_STATE, id, next);
    }
}

export function removeDraft(seasonId) {
    const scope = draftScope(seasonId);
    return Promise.all([picks.removeAll(scope), repository.remove(DRAFT_STATE, scope)]);
}
