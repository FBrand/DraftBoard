/**
 * Schools for the players a team roster listing does not contain.
 *
 * fetch-nfl-schools.mjs walks the 32 published rosters, which is most of the
 * league but not all of it: a practice-squad player or a late signing is under
 * contract and on the depth chart here while being absent from the listing.
 * Those were exactly the players still blank — the fringe of the roster, which
 * is the part an analyst is least likely to know from memory and most likely
 * to want the card for.
 *
 * So this takes the names still missing and looks each one up individually:
 * search for the player, take his athlete id, follow the college reference.
 * Slower per player, which is why it is the fallback rather than the method.
 *
 *   node scripts/fetch-missing-schools.mjs <name>...   -> merged into
 *                                                        data/nfl_schools.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CACHE = new URL('../data/nfl_schools.json', import.meta.url);
const SEARCH = (q) => `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(q)}&limit=5`;
const ATHLETE = (id) => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${id}`;

const names = process.argv.slice(2);
if (!names.length) {
    console.error('usage: fetch-missing-schools.mjs <name>...');
    process.exit(1);
}

const cache = JSON.parse(readFileSync(CACHE, 'utf8'));
const norm = (s) => String(s ?? '').toLowerCase().replace(/[.,'`’-]/g, '').replace(/\s+/g, ' ').trim();
const known = new Set(cache.players.filter(p => p.school).map(p => norm(p.name)));

const getJSON = async (url) => {
    const res = await fetch(url, { headers: { 'user-agent': 'DraftBoard/seed' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
};

let added = 0;
for (const name of names) {
    if (known.has(norm(name))) { console.error(`= ${name} (already known)`); continue; }
    try {
        const found = await getJSON(SEARCH(name));
        const player = found.results?.find(r => r.type === 'player')?.contents
            // The search is fuzzy — "Damon Payne" also returns "Damon Wayne".
            // Only an exact name match is this player.
            ?.find(c => norm(c.displayName) === norm(name));
        if (!player) { console.error(`? ${name}: no exact match`); continue; }

        const id = String(player.uid ?? '').split('a:')[1];
        if (!id) { console.error(`? ${name}: no athlete id`); continue; }

        const athlete = await getJSON(ATHLETE(id));
        const ref = athlete.college?.$ref;
        if (!ref) { console.error(`? ${name}: no college on record`); continue; }

        const college = await getJSON(ref);
        const school = college.name ?? college.shortName ?? '';
        if (!school) { console.error(`? ${name}: college has no name`); continue; }

        cache.players.push({
            name: athlete.displayName ?? name,
            position: athlete.position?.abbreviation ?? '',
            school,
            team: '',
            experience: athlete.experience?.years ?? null,
        });
        added += 1;
        console.error(`+ ${name} -> ${school}`);
    } catch (err) {
        console.error(`! ${name}: ${err.message}`);
    }
}

cache.fetchedAt = new Date().toISOString();
writeFileSync(CACHE, JSON.stringify(cache, null, 1));
console.error(`\nadded ${added} of ${names.length}`);
