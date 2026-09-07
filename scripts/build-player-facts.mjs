/**
 * Seed data the rankings files cannot carry: school, and the draft outcome.
 *
 * Three sources, because no one of them covers the people on screen:
 *
 *   draft2026.json          the 2026 class and where each went. Authoritative
 *                           for the draft outcome; a school for only ~71%.
 *   rankings_sttm_source    a school for every RANKED prospect, drafted or not.
 *   data/nfl_schools.json   a school for everyone under contract in the
 *                           league — see fetch-nfl-schools.mjs.
 *
 * The third exists because seeding from the draft file alone left every
 * veteran blank: 81 of the 91 players on the roster had no school, so the card
 * was empty for exactly the players the audience already knows. Rookies had a
 * school and Mahomes did not.
 *
 * Draft facts for veterans are NOT sought here. roster.csv already records how
 * every player arrived, in the suffix on his name, and parseAcquisition reads
 * it on import — a second source for the same fact could only disagree with it.
 *
 *   node scripts/build-player-facts.mjs > public/player_facts_2026.csv
 *
 * Regenerate when a source updates; do not hand-edit the output.
 */
import { readFileSync } from 'node:fs';

const DRAFT = '/srv/dev/DraftBoard/Knowledgebase/draft2026.json';
const STTM = '/srv/dev/DraftBoard/rankings/rankings_sttm_source.csv';
const LEAGUE = new URL('../data/nfl_schools.json', import.meta.url);

// Names arrive from three sources that punctuate and capitalise differently.
const norm = (s) => String(s ?? '').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[.,'`’-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const rows = new Map();   // normalised name -> row
const put = (name, patch) => {
    const key = norm(name);
    if (!key) return;
    const existing = rows.get(key) ?? {
        name, position: '', school: '', draftYear: '', draftRound: '', draftPick: '', team: '',
    };
    // Never overwrite something an earlier, more authoritative source set.
    Object.entries(patch).forEach(([k, v]) => {
        if (v !== '' && v != null && !existing[k]) existing[k] = v;
    });
    rows.set(key, existing);
};

// 1. The draft. Authoritative for the outcome, so it goes first.
const draft = JSON.parse(readFileSync(DRAFT, 'utf8'));
const clubs = new Map((draft.teams ?? []).map(t => [String(t.id), t.abbreviation]));
const positions = new Map((draft.positions ?? []).map(p => [String(p.id), p.abbreviation]));

for (const pick of draft.picks ?? []) {
    const a = pick.athlete;
    if (!a?.displayName) continue;
    put(a.displayName, {
        // `athlete.team` is the COLLEGE here, not the NFL club — the club is
        // `teamId`, resolved against the file's own team list.
        position: positions.get(String(a.position?.id)) ?? '',
        school: a.team?.shortDisplayName ?? a.team?.location ?? '',
        draftYear: draft.year ?? '',
        draftRound: pick.round ?? '',
        draftPick: pick.overall ?? '',
        team: clubs.get(String(pick.teamId)) ?? '',
    });
}

// 2. Ranked prospects, drafted or not.
const sttm = readFileSync(STTM, 'utf8').split('\n').slice(1).filter(l => l.trim());
for (const line of sttm) {
    const c = line.split(',');
    if (!c[0]?.trim()) continue;
    put(c[0].trim(), { position: (c[1] ?? '').trim(), school: (c[2] ?? '').trim() });
}

// 3. Everyone under contract. Last, so it only ever fills a blank.
const league = JSON.parse(readFileSync(LEAGUE, 'utf8'));
for (const p of league.players ?? []) {
    put(p.name, {
        position: p.position, school: p.school, team: p.team,
        // Draft history for the roster's veterans — see
        // fetch-draft-history.mjs. Absent for most of the league, which is
        // fine: put() only ever fills a blank.
        draftYear: p.draftYear, draftRound: p.draftRound, draftPick: p.draftPick,
    });
}

const csvField = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const COLUMNS = ['name', 'position', 'school', 'draftYear', 'draftRound', 'draftPick', 'team'];
const out = [COLUMNS.join(',')];
for (const row of rows.values()) out.push(COLUMNS.map(c => csvField(row[c])).join(','));
process.stdout.write(out.join('\n') + '\n');

const all = [...rows.values()];
console.error(`${all.length} players | ${all.filter(r => r.school).length} with a school | ${all.filter(r => r.draftPick).length} with a draft outcome`);
