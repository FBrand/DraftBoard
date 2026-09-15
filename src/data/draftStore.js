/**
 * The draft, as facts about players.
 *
 * There used to be a `draft_picks` collection: one document per selection,
 * saying who was taken, at which pick, by which club, in which season. Every
 * one of those is already a field on the player's registry record —
 * `draftPick`, `team`, `draftYear`, `isUdfa` — so the store was a second
 * place recording the same event, and the two could disagree.
 *
 * They did. The registry knew a draft outcome for 295 players, seeded from
 * `player_facts_2026.csv`; the picks collection held 631 selections, seeded
 * from `DraftBoard_Picks.csv`. Same draft, two files, two stores, two answers,
 * and 210KB of a 745KB budget spent on the duplicate.
 *
 * So a pick is not stored. It is *recorded on the player*, and the draft is
 * read back by asking the registry who was taken in this season's year.
 *
 * What remains here is the only part that is genuinely the draft's own and not
 * any player's: whose turn it is, and which picks we still hold. That is one
 * small document per season, and it is not a list anyone edits in parallel —
 * "which pick are we on" has one answer.
 */
import { repository } from './repository';
import { getSessionTeam } from '../utils/appSettings';
import { seasonFields } from './fieldNames';
import {
    PLAYERS, byId, loadRegistry, setFactsMany, factsFor, resolveAll,
} from '../utils/playerRegistry';

export const DRAFT_STATE = 'draft_state';

/** The season a draft belongs to. Still the id; nothing else needs saying. */
export const draftScope = (seasonId) => `${seasonId ?? '_'}`;

/**
 * The calendar year of a season, read straight from the seasons collection.
 *
 * Deliberately not `boardRegistry.currentSeason()`: boardRegistry imports this
 * module to scrap a season's draft, and importing it back would close the
 * cycle. The collection is the same one either way.
 */
function yearOf(seasonId) {
    if (!seasonId) return null;
    // Through the season's field map. Read raw, `season.year` is undefined —
    // the store writes `y` — so this returned null, draftedIn matched nobody,
    // and the whole draft read as empty while the data sat there intact.
    const season = seasonFields.fat(repository.get('seasons', seasonId));
    return Number.isFinite(season?.year) ? season.year : null;
}

export function openDraft() {
    return Promise.all([repository.ready(DRAFT_STATE), repository.ready(PLAYERS), repository.ready('seasons')]);
}

/**
 * A player's draft record, in the shape the draft board has always used.
 *
 * `pickNumber` is the literal string `UDFA` for an undrafted signing, which is
 * what `draftPhase.isUndraftedSigning` reads and what the card prints. It is
 * not a number, and nothing should do arithmetic on it.
 *
 * `draftedByUs` is a comparison rather than a fact — the pick's club against
 * whose offseason this is — so it is answered here rather than stored. An
 * absent club is "signed, no club yet" and is nobody's.
 */
function asPick(record) {
    const team = record.team ?? null;
    return {
        playerId: record.id,
        name: record.name,
        position: record.position ?? '',
        pickNumber: record.draftPick ?? 'UDFA',
        team,
        draftedByUs: !!team && team === getSessionTeam(),
        drafted: true,
    };
}

/** Everyone the registry says entered the league in this season's year. */
function draftedIn(seasonId) {
    const year = yearOf(seasonId);
    if (year == null) return [];
    return loadRegistry()
        .filter(r => r.draftYear === year && (r.draftPick != null || r.isUdfa === true))
        .map(asPick)
        // Drafted players in pick order, then the undrafted, who have no order
        // at all — there is no sequence to who signed first.
        .sort((a, b) => {
            const an = Number(a.pickNumber), bn = Number(b.pickNumber);
            const aNum = Number.isFinite(an), bNum = Number.isFinite(bn);
            if (aNum && bNum) return an - bn;
            if (aNum !== bNum) return aNum ? -1 : 1;
            return String(a.name).localeCompare(String(b.name));
        });
}

/**
 * Whether this season's draft has been SET UP — not whether anybody in the
 * registry happens to carry a draft year.
 *
 * Those are different questions and conflating them broke the seed.
 * `player_facts_2026.csv` gives 295 players a 2026 draft outcome on first
 * load, so asking the registry "is anyone drafted" answered yes before
 * anything had been drafted. The app concluded a draft already existed, skipped
 * seeding from DraftBoard_Picks.csv, and showed 386 drafted cards above a
 * counter reading pick #1.
 *
 * The state document is the honest marker: it exists once this season's draft
 * has been written, and not before.
 */
export function hasDraft(seasonId) {
    return !!repository.get(DRAFT_STATE, draftScope(seasonId));
}

export function readDraft(seasonId) {
    const scope = draftScope(seasonId);
    const rest = repository.get(DRAFT_STATE, scope);
    const draftedPlayers = draftedIn(seasonId);
    if (!rest && !draftedPlayers.length) return null;
    return { ...(rest?.value ?? {}), draftedPlayers };
}

/**
 * What is worth keeping, listed rather than inferred.
 *
 * The draft record used to be whatever the hook happened to be holding, spread
 * in — which meant it also stored `players`, the entire board, and `yourPicks`,
 * a second copy of the picks already there. Neither is ever read back: the
 * board is rebuilt from the rankings file reconciled with the picks, and
 * yourPicks is recomputed on load. A list rather than a rest-spread, so the
 * next field added to the hook does not quietly join it.
 */
const KEPT = ['currentPick', 'ourPicksLeft', 'remotePicks'];

/** The fields a selection sets on a player. Everything else is his own. */
const DRAFT_FACTS = ['draftYear', 'draftPick', 'team', 'isUdfa'];

function pickFacts(p, year) {
    const n = Number(p?.pickNumber);
    const numbered = Number.isFinite(n);
    return {
        draftYear: year,
        draftPick: numbered ? n : null,
        // Explicitly false for a real selection and true for a signing, so
        // "unknown" stays distinguishable from "went undrafted".
        isUdfa: !numbered,
        // An explicitly empty club is "signed, no club yet" and must survive.
        team: p?.team ?? null,
    };
}

export function writeDraft(seasonId, state) {
    const scope = draftScope(seasonId);
    const year = yearOf(seasonId);

    // --- the picks, onto the players ---
    if (year != null && Array.isArray(state?.draftedPlayers)) {
        // A pick can be somebody no rankings file has ever heard of — a UDFA,
        // or a player from another class. The old pick document carried his
        // name and position for exactly that reason, and it was the only
        // record of him there was. With the draft on the registry he has to BE
        // in the registry, so an unregistered pick is registered here rather
        // than dropped. Dropping them cost 300 players the first time.
        const unknown = state.draftedPlayers.filter(p => p && !p.playerId && p.name);
        const minted = unknown.length
            ? resolveAll(unknown.map(p => ({ name: p.name, position: p.position, school: p.school })))
            : [];
        const idFor = new Map();
        unknown.forEach((p, i) => { if (minted[i]) idFor.set(p, minted[i]); });

        const wanted = new Map();
        state.draftedPlayers.forEach(p => {
            const id = p?.playerId ?? idFor.get(p) ?? null;
            if (id) wanted.set(id, pickFacts(p, year));
        });

        const updates = [];
        // Anyone the registry has in this year who is no longer in the list
        // has been undrafted — undo, or a cleared draft.
        draftedIn(seasonId).forEach(({ playerId }) => {
            if (!wanted.has(playerId)) {
                updates.push({ id: playerId, patch: Object.fromEntries(DRAFT_FACTS.map(f => [f, null])) });
            }
        });
        wanted.forEach((facts, id) => {
            const before = factsFor(id);
            if (!before) return;
            if (DRAFT_FACTS.every(f => (before[f] ?? null) === (facts[f] ?? null))) return;
            updates.push({ id, patch: facts });
        });
        if (updates.length) setFactsMany(updates);
    }

    // --- whose turn it is ---
    const rest = {};
    KEPT.forEach(k => { if (state?.[k] !== undefined) rest[k] = state[k]; });
    const before = repository.get(DRAFT_STATE, scope);
    if (!before || JSON.stringify(before.value ?? {}) !== JSON.stringify(rest)) {
        // The season is the key. It was in the body too — the last document in
        // the app still stating its own address.
        repository.set(DRAFT_STATE, scope, { value: rest });
    }
}

/**
 * Scrapping a season's draft.
 *
 * This clears draft facts off the players it took, which is a destructive write
 * to the registry and deliberately narrow: only records whose `draftYear` is
 * this season's year. A roster veteran drafted in 2021 has his own draftYear
 * and is not touched.
 */
export function removeDraft(seasonId) {
    const doomed = draftedIn(seasonId);
    if (doomed.length) {
        setFactsMany(doomed.map(({ playerId }) => ({
            id: playerId,
            patch: Object.fromEntries(DRAFT_FACTS.map(f => [f, null])),
        })));
    }
    return repository.remove(DRAFT_STATE, draftScope(seasonId));
}

/** Kept so a caller can ask about one player without reading the whole draft. */
export function pickFor(playerId) {
    const record = byId(playerId);
    return record && (record.draftPick != null || record.isUdfa === true) ? asPick(record) : null;
}
