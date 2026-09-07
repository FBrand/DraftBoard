/**
 * Where every player in the league went to college.
 *
 * The draft file only knows the incoming class, so seeding schools from it
 * left every veteran on the roster blank — 81 of 91 roster players had no
 * school, which is to say the scouting card was empty for exactly the players
 * everybody already knows. Rookies had a school; Mahomes did not.
 *
 * ESPN publishes it per team roster, so this walks all 32 and caches the
 * result. Cached rather than fetched at run time on purpose: the app is
 * static, offline-capable and has no backend, and a page load should not
 * depend on somebody else's API being up.
 *
 *   node scripts/fetch-nfl-schools.mjs        -> data/nfl_schools.json
 *
 * Re-run it when the rosters move. It is offline tooling, not app code.
 */
import { writeFileSync } from 'node:fs';

const TEAMS_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams';
const ROSTER = (slug) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${slug}/roster`;

async function getJSON(url) {
    const res = await fetch(url, { headers: { 'user-agent': 'DraftBoard/seed' } });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.json();
}

const teamList = await getJSON(TEAMS_URL);
const teams = (teamList.sports?.[0]?.leagues?.[0]?.teams ?? []).map(t => t.team);
if (!teams.length) throw new Error('no teams in the ESPN response');

const players = [];
const seen = new Set();

for (const team of teams) {
    const slug = team.abbreviation?.toLowerCase();
    let roster;
    try {
        roster = await getJSON(ROSTER(slug));
    } catch (err) {
        // One club being unavailable should not cost the other 31.
        console.error(`! ${slug}: ${err.message}`);
        continue;
    }

    const athletes = (roster.athletes ?? []).flatMap(g => g.items ?? g);
    let withSchool = 0;

    for (const a of athletes) {
        const name = a?.displayName?.trim();
        const school = a?.college?.name?.trim();
        if (!name) continue;
        // A player can appear on two rosters across a transaction window;
        // first sighting wins rather than writing him twice.
        const key = `${name}|${a?.position?.abbreviation ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (school) withSchool += 1;
        players.push({
            name,
            position: a?.position?.abbreviation ?? '',
            school: school ?? '',
            team: team.abbreviation ?? '',
            experience: a?.experience?.years ?? null,
        });
    }
    console.error(`${slug.padEnd(3)} ${String(athletes.length).padStart(3)} players, ${withSchool} with a school`);
}

const out = { fetchedAt: new Date().toISOString(), source: TEAMS_URL, players };
writeFileSync(new URL('../data/nfl_schools.json', import.meta.url), JSON.stringify(out, null, 1));
console.error(`\n${players.length} players, ${players.filter(p => p.school).length} with a school`);
