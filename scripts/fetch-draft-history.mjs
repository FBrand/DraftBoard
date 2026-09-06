/**
 * How the veterans on the roster entered the league.
 *
 * roster.csv records it in the name suffix — ":24/1" — but only for players
 * somebody typed it for. A holdover carries no suffix, so his card showed a
 * school and then nothing: no draft year, no round, no pick. That is most of
 * the roster, and they are the players the audience knows best.
 *
 * The team roster listing does not carry it. The per-athlete endpoint does, so
 * this looks up only the players we actually hold — the roster, not the league
 * — and merges the result into data/nfl_schools.json for the facts build.
 *
 *   node scripts/fetch-draft-history.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CACHE = new URL('../data/nfl_schools.json', import.meta.url);
const ROSTER = new URL('../public/roster.csv', import.meta.url);
const SEARCH = (q) => `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(q)}&limit=5`;
const ATHLETE = (id) => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${id}`;

const norm = (s) => String(s ?? '').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[.,'`’-]/g, '')
    .replace(/\s+/g, ' ').trim();

const getJSON = async (url) => {
    const res = await fetch(url, { headers: { 'user-agent': 'DraftBoard/seed' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
};

// Every name on the roster, stripped of its zone prefix and arrival suffix.
const names = [];
readFileSync(ROSTER, 'utf8').split('\n').slice(1).filter(l => l.trim()).forEach(line => {
    const cells = line.split(',');
    cells.slice(cells[0] === 'S' ? 2 : 3).forEach(cell => {
        const t = cell.trim();
        if (!t) return;
        const n = t.replace(/^(R|PS|IR):/, '');
        const at = n.lastIndexOf(':');
        names.push(at === -1 ? n : n.slice(0, at));
    });
});

const cache = JSON.parse(readFileSync(CACHE, 'utf8'));
const byName = new Map(cache.players.map(p => [norm(p.name), p]));

let filled = 0, missed = 0;
for (const name of names) {
    const record = byName.get(norm(name));
    if (record?.draftYear || record?.isUdfa) continue;   // already known

    try {
        const found = await getJSON(SEARCH(name));
        const hit = found.results?.find(r => r.type === 'player')?.contents
            ?.find(c => norm(c.displayName) === norm(name));
        const id = String(hit?.uid ?? '').split('a:')[1];
        if (!id) { missed++; console.error(`? ${name}`); continue; }

        const a = await getJSON(ATHLETE(id));
        const target = record ?? { name, position: a.position?.abbreviation ?? '', school: '', team: '' };
        if (!record) { cache.players.push(target); byName.set(norm(name), target); }

        if (a.draft?.year) {
            target.draftYear = a.draft.year;
            target.draftRound = a.draft.round ?? null;
            target.draftPick = a.draft.selection ?? null;
            console.error(`+ ${name} -> ${a.draft.year} rd ${a.draft.round} pick ${a.draft.selection}`);
        } else {
            // No draft record at all is itself the fact: he went undrafted.
            target.isUdfa = true;
            console.error(`+ ${name} -> undrafted`);
        }
        filled++;
    } catch (err) {
        missed++;
        console.error(`! ${name}: ${err.message}`);
    }
}

cache.fetchedAt = new Date().toISOString();
writeFileSync(CACHE, JSON.stringify(cache, null, 1));
console.error(`\nfilled ${filled}, missed ${missed}, of ${names.length} roster players`);
