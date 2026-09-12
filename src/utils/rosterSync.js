/**
 * Filling the roster from the stages that came before it.
 *
 * Free agency, the draft and UDFA each decide who arrives; the roster is where
 * they land. This walks all three and drops each player into the first free
 * 53-man slot of his position row.
 *
 * Two rules make it safe to run whenever you like, which is the point — it is
 * not a one-time bootstrap that goes stale:
 *
 *   - it only ever FILLS. Nothing occupied is overwritten, nothing is removed,
 *     so a placement made by hand after an earlier run survives the next one.
 *   - a player it cannot place is skipped and counted, never guessed at. No
 *     inventing a position row, no overflowing into the practice squad.
 *
 * It lived inside RosterView, where the only way to test it was to drive a
 * browser. It is a function of three values and a fourth out: it belongs here.
 */
import { makeSlot, resolvePosition } from './rosterState';
import { isDraftPick, isUndraftedSigning } from './draftPhase';

/** The name on a cut/reserve entry, which may be a slot or a bare name. */
const nameOf = (entry) => (typeof entry === 'string' ? entry : entry?.name ?? null);

/**
 * @returns {{next: object, placed: number, noRow: number, rowFull: number,
 *            alreadyPresent: number, changed: boolean}}
 *   `next` is the new roster state; the counts are what to tell the user.
 *   `changed` is false when nothing moved, and then `next` is the state given.
 */
export function syncFromStages({ state, fa = null, draftedPlayers = [] }) {
    const ourPicks = (draftedPlayers || []).filter(p => p.draftedByUs && isDraftPick(p));
    const udfaSignings = (draftedPlayers || []).filter(isUndraftedSigning);

    let placed = 0, noRow = 0, rowFull = 0, alreadyPresent = 0;

    const next = { ...state, depthChart: { ...state.depthChart } };
    const dc = next.depthChart;
    const allChips = [...state.positionConfig.offense, ...state.positionConfig.defense];

    // Cuts and reserve hold SLOTS now, not bare names — they carry how the
    // player arrived, so a man moved out and back is still a free agent rather
    // than becoming a plain veteran. A membership test written against the old
    // shape silently stopped matching, and sync would haul a player you had
    // just cut straight back onto the 53.
    const isAlreadyOnRoster = (name) =>
        Object.values(dc).some(slots => (slots ?? []).some(s => s?.name === name))
        || (next.reserve ?? []).some(r => nameOf(r) === name)
        || (next.cuts ?? []).some(c => nameOf(c) === name);

    const placeInFirstEmpty53 = (name, declaredPos) => {
        if (!name || !declaredPos) return;
        if (isAlreadyOnRoster(name)) { alreadyPresent++; return; }

        const rowId = resolvePosition(declaredPos, state.positionConfig, dc);
        if (!rowId) { noRow++; return; } // leave for manual placement, don't guess a new row

        const limit53 = allChips.find(p => p.id === rowId)?.slots53 ?? 2;
        const arr = dc[rowId] = [...(dc[rowId] ?? [])];
        for (let i = 0; i < limit53; i += 1) {
            if (!arr[i]) { arr[i] = makeSlot(name, '53'); placed += 1; return; }
        }
        rowFull += 1; // full — don't overflow into the practice squad, don't overwrite
    };

    if (fa?.depthChart) {
        const faChips = [...(fa.positionConfig?.offense ?? []), ...(fa.positionConfig?.defense ?? [])];
        Object.entries(fa.depthChart).forEach(([faRowId, slots]) => {
            const label = faChips.find(p => p.id === faRowId)?.label ?? faRowId;
            (slots || []).forEach(s => { if (s) placeInFirstEmpty53(s.name, label); });
        });
    }
    ourPicks.forEach(p => placeInFirstEmpty53(p.name, p.position));
    udfaSignings.forEach(p => placeInFirstEmpty53(p.name, p.position));

    return {
        next: placed > 0 ? next : state,
        changed: placed > 0,
        placed, noRow, rowFull, alreadyPresent,
    };
}

/** What to show after a run. Separate from the work so the wording is testable. */
export function describeSync({ placed, noRow, rowFull, alreadyPresent }) {
    const skips = [
        noRow && `${noRow} had no matching position row`,
        rowFull && `${rowFull} had no free 53-man slot`,
        alreadyPresent && `${alreadyPresent} already on the roster`,
    ].filter(Boolean);

    if (placed > 0) {
        return {
            message: `Placed ${placed} player${placed === 1 ? '' : 's'}`
                + (skips.length ? ` — skipped: ${skips.join(', ')}.` : '.'),
            tone: 'success',
        };
    }
    return {
        message: skips.length
            ? `Nothing placed — ${skips.join(', ')}.`
            : 'Nothing to sync — no FA candidates, draft picks, or UDFA signings found.',
        tone: 'info',
    };
}
