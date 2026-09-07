/**
 * The worked example that ships with the app.
 *
 * `public/evaluations_kc_2026.csv` holds the seven Chiefs picks from the 2026
 * draft with ten to fourteen remarks each, taken from Bleacher Report's
 * scouting reports. Left as a file nobody imports, it demonstrates nothing —
 * a new board shows empty remark lists on every player and there is no way to
 * see what a filled-in one looks like without typing one yourself.
 *
 * So it is seed data, like the schools and the draft outcomes: applied on a
 * first run, in seeded mode only, and never on top of anything. Every guard
 * here is about not writing over somebody's work:
 *
 *   - clean-slate mode seeds nothing at all;
 *   - it writes to the CONSENSUS board, the one with no author, because these
 *     are published scouting reports rather than anybody here having watched
 *     the tape;
 *   - a player who already carries remarks from this owner is skipped
 *     entirely, so re-running cannot duplicate anything;
 *   - and players are resolved WITHOUT creating, so it can only ever annotate
 *     somebody already on the board.
 */
import { parseRankings } from './dataParser';
import { resolveAll } from './playerRegistry';
import { listBoards } from './boardRegistry';
import { ownerIdFor, remarksFor, addRemark } from './evaluations';
import { currentSeason } from './boardRegistry';
import { shouldSeed } from './appInit';

const FILE = 'evaluations_kc_2026.csv';

let done = false;

export async function seedExampleEvaluations() {
    if (done || !shouldSeed()) return 0;
    done = true;

    // Consensus is the board with no author — see boardRegistry.
    const board = listBoards().find(b => !b.authorId);
    const ownerId = board ? ownerIdFor(board) : null;
    if (!ownerId) return 0;

    let rows;
    try {
        const res = await fetch(`${import.meta.env.BASE_URL}${FILE}`);
        if (!res.ok) return 0;
        rows = parseRankings(await res.text()).filter(r => r.remarks?.length);
    } catch {
        return 0;   // an example is a nicety; never let it break a load
    }
    if (!rows.length) return 0;

    const ids = resolveAll(
        rows.map(r => ({ name: r.name, position: r.position, school: r.school })),
        { create: false },
    );

    const seasonId = currentSeason()?.id ?? null;
    let written = 0;

    rows.forEach((row, i) => {
        const playerId = ids[i];
        if (!playerId) return;
        // Anything already said about him is somebody's work. Leave it.
        if (remarksFor(ownerId, playerId).length) return;
        row.remarks.forEach(r => {
            addRemark(ownerId, playerId, r.kind, r.text, seasonId);
            written += 1;
        });
    });

    return written;
}
