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
 *   - it is attributed to ONE named analyst, Dan. These are published scouting
 *     reports, so in truth they are nobody here's words — but a remark is a
 *     person's opinion and there is no unattributed voice to file them under.
 *     Consensus remarks were considered and dropped: making the consensus
 *     voice writable through the app turns one document into a multi-writer
 *     one, and the remark shape assumes a single writer (whole-document
 *     replace, positional ids). So the example borrows a name rather than
 *     inventing one, and it is seed data an analyst is free to delete;
 *   - a player who already carries remarks from this owner is skipped
 *     entirely, so re-running cannot duplicate anything;
 *   - and players are resolved WITHOUT creating, so it can only ever annotate
 *     somebody already on the board.
 */
import { parseRankings } from '../../src/utils/dataParser';
import { resolveAll } from '../../src/utils/playerRegistry';
import { listBoards } from '../../src/utils/boardRegistry';
import { remarksFor, addRemark, openEvaluations } from '../../src/utils/evaluations';
import { currentSeason } from '../../src/utils/boardRegistry';
import { shouldSeed } from '../../src/utils/appInit';
import { repository } from '../../src/data/repository';

const FILE = 'evaluations_kc_2026.csv';

/** Whose voice the example is filed under. See the note above on why a name. */
const EXAMPLE_ANALYST = 'dan';

let done = false;

export async function seedExampleEvaluations() {
    if (done || !shouldSeed()) return 0;

    // Not on a shared backend, ever. There the database is seeded from outside
    // (scripts/seed-firestore.mjs) before anybody signs in, and a client that
    // seeds as well writes these remarks in the voice of whoever happens to be
    // signed in — which put Bleacher Report's scouting reports into Firestore
    // under a named analyst's uid, as his own words. A remark is a person's
    // opinion, so there is no correct person to attribute a published report
    // to, and the answer is not to pick one.
    if (repository.isLive()) return 0;

    done = true;

    // Dan's voice, found by slug rather than by label — a label renames freely
    // and nothing keys on it, while the slug is stable. If his board is absent
    // (a renamed slug, a season that never set him up) the example is simply
    // skipped: it is a nicety, and guessing a different analyst to attribute
    // published reports to would be worse than showing nothing.
    const ownerId = listBoards().find(b => b.slug === EXAMPLE_ANALYST)?.authorId ?? null;
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

    // What is already there has to be READABLE before "nothing is there" can
    // mean anything. These seven paths are exactly the ones this example would
    // write, and writing over an analyst's own remarks is the one thing it
    // must never do.
    await openEvaluations(ids.filter(Boolean));

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
