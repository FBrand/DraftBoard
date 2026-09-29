/**
 * The two ways a personal chart and the official one meet.
 *
 * Nothing merges on its own, and that is a decision rather than an omission:
 * one analyst having a player where official has somebody else is a
 * disagreement, not a conflict, and a rule that picks a winner has the app
 * asserting an opinion nobody holds. So there are deliberate acts — publish,
 * take, fill the gaps — and the app never quietly reconciles anything.
 *
 * Written once, for both stages that keep a depth chart. The roster had these
 * functions first and free agency needs the same four; copying them would have
 * meant two copies of `playersNotIn`, whose first version was wrong in a way
 * nothing on screen would have shown (see the note there). One subtle
 * comparison, in one place.
 *
 * The stage injects its own `loadState`/`saveState` rather than being called by
 * them, because those two carry the guards that matter — an archived season is
 * not a workspace, a chart from a newer build is not overwritten, a chart with
 * no season has nowhere to go — and none of that should be restated here.
 */
import { readChart, writeChart, hasChart, hasOwnChart, readStamp, writeStamp, OFFICIAL } from '../data/depthChartStore';
import { slotIdentity } from './formatName';

/**
 * How two charts are compared, player by player.
 *
 * The player id where a slot carries one, the shown name otherwise — the same
 * order of preference the roster uses everywhere else, and it matters here
 * because two charts written at different times may have resolved the same man
 * with and without an id.
 *
 * The first version of this read `slotIdentity(slot).name`, which does not
 * exist — that function returns displayName/suffix/nameColor. So every
 * comparison was undefined against undefined, nobody was ever found displaced,
 * and taking the official chart would have dropped players exactly as a plain
 * replacement does. Silently. The unit test caught it; no screen would have.
 */
const slotKey = (slot) => {
    if (!slot) return null;
    if (slot.playerId) return `id:${slot.playerId}`;
    const shown = slotIdentity(slot).displayName;
    return shown ? `name:${shown.toLowerCase()}` : null;
};

/** Everybody in `from` who is nowhere in `to`, as slots ready for the cuts. */
function playersNotIn(from, to) {
    const held = new Set();
    const note = (sl) => { const k = slotKey(sl); if (k) held.add(k); };
    Object.values(to.depthChart ?? {}).forEach(slots => (slots ?? []).forEach(note));
    (to.cuts ?? []).forEach(note);
    (to.reserve ?? []).forEach(note);

    const out = [];
    const seen = new Set();
    Object.values(from.depthChart ?? {}).forEach(slots => (slots ?? []).forEach(sl => {
        const k = slotKey(sl);
        if (!k || held.has(k) || seen.has(k)) return;
        seen.add(k);
        out.push(sl);
    }));
    return out;
}

/**
 * @param {object} cfg
 * @param {string} cfg.stage         the chart key, 'rosterState' or 'fa_state_v1'
 * @param {() => string|null} cfg.seasonId
 * @param {() => object|null} cfg.loadState   this person's chart, with its guards
 * @param {(state: object) => void} cfg.saveState
 * @param {(state: object) => object|null} cfg.migrate
 * @param {number} cfg.version
 * @param {(chart: object) => object} [cfg.stampIds]
 */
export function createOfficialVersion({ stage, seasonId, loadState, saveState, migrate, version, stampIds = (x) => x }) {
    /**
     * The official chart — what the show says, as opposed to what I would do.
     *
     * Null when nobody has published one, which is not an empty chart: the
     * first tells a screen there is nothing to take, the second that what it
     * would take is empty.
     */
    function loadOfficial() {
        try {
            const sid = seasonId();
            if (!sid || !hasChart(stage, sid, OFFICIAL)) return null;
            return migrate({ version, ...readChart(stage, sid, OFFICIAL) });
        } catch { return null; }
    }

    /** Whether what I am looking at is mine, or official for want of one. */
    const isOwn = () => {
        const sid = seasonId();
        return !!sid && hasOwnChart(stage, sid);
    };

    /** Who published official, and when. Null where nobody has. */
    const officialStamp = () => {
        const sid = seasonId();
        return sid ? readStamp(stage, sid) : null;
    };

    /**
     * Publishes my chart as the official one.
     *
     * The caller is expected to have asked first: this overwrites whatever
     * another expert published, and a chart that changed under somebody with no
     * way to see who did it is the failure this project keeps repeating. Hence
     * the stamp, which is the reason this is a function and not an argument to
     * saveState.
     */
    function publishOfficial(state = loadState()) {
        const sid = seasonId();
        if (!sid || !state) return false;
        writeChart(stage, sid, { ...state, version, depthChart: stampIds(state.depthChart) }, OFFICIAL);
        writeStamp(stage, sid);
        return true;
    }

    /**
     * Takes official as mine, keeping everybody I would otherwise lose.
     *
     * Anybody in my chart who is not in official goes to the CUT PANEL rather
     * than disappearing. That is the difference between adopting a state and
     * losing an afternoon's work — a plain replacement is the one version of
     * this that must not ship, because the players simply vanish and nothing
     * says which ones.
     */
    function adoptOfficial() {
        const official = loadOfficial();
        if (!official) return null;

        const mine = loadState();
        const displaced = mine ? playersNotIn(mine, official) : [];
        saveState({ ...official, cuts: [...(official.cuts ?? []), ...displaced] });
        return { adopted: true, displaced: displaced.length };
    }

    /**
     * Fills my empty slots from official, touching nothing I have placed.
     *
     * The additive half, and the rule the roster's stage sync has always
     * followed: safe to run again whenever official moves.
     */
    function fillFromOfficial() {
        const official = loadOfficial();
        const mine = loadState();
        if (!official || !mine) return null;

        const next = { ...mine, depthChart: { ...mine.depthChart } };
        let filled = 0;
        Object.entries(official.depthChart ?? {}).forEach(([rowId, slots]) => {
            const row = [...(next.depthChart[rowId] ?? [])];
            (slots ?? []).forEach((slot, i) => {
                if (!slot || row[i]) return;   // never over something I placed
                row[i] = slot;
                filled += 1;
            });
            next.depthChart[rowId] = row;
        });

        if (filled) saveState(next);
        return { filled };
    }

    return { loadOfficial, isOwn, officialStamp, publishOfficial, adoptOfficial, fillFromOfficial };
}
