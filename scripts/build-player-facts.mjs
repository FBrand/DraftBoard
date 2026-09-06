/**
 * Turns a completed ESPN draft file into seed data for the app.
 *
 * The rankings CSVs carry `group,name,position,favourite` and nothing else —
 * no school, no draft outcome. Both exist in the draft file, so rather than
 * hand-editing three curated rankings files, this derives a separate seed the
 * app applies on load. Regenerate it when the source updates; do not hand-edit
 * the output.
 *
 *   node scripts/build-player-facts.mjs <draft.json> > public/player_facts_2026.csv
 *
 * Note on the source: `athlete.team` is the COLLEGE, not the NFL club. The
 * drafting club is `teamId`, resolved against the file's own `teams` list.
 */
import { readFileSync } from 'node:fs';

const source = process.argv[2];
if (!source) {
    console.error('usage: build-player-facts.mjs <draft.json>');
    process.exit(1);
}

const draft = JSON.parse(readFileSync(source, 'utf8'));
const teams = new Map((draft.teams ?? []).map(t => [String(t.id), t.abbreviation]));
const positions = new Map((draft.positions ?? []).map(p => [String(p.id), p.abbreviation]));

// The rounds are uneven — compensatory picks — so the round comes from the
// file rather than from dividing the pick number.
const csvField = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = [['name', 'position', 'school', 'draftYear', 'draftRound', 'draftPick', 'team']];

for (const pick of draft.picks ?? []) {
    const a = pick.athlete;
    if (!a?.displayName) continue;
    rows.push([
        a.displayName,
        positions.get(String(a.position?.id)) ?? '',
        // shortDisplayName is what a broadcast says ("Indiana", not "Indiana
        // Hoosiers" and not "IU").
        a.team?.shortDisplayName ?? a.team?.location ?? '',
        draft.year ?? '',
        pick.round ?? '',
        pick.overall ?? '',
        teams.get(String(pick.teamId)) ?? '',
    ]);
}

process.stdout.write(rows.map(r => r.map(csvField).join(',')).join('\n') + '\n');
console.error(`${rows.length - 1} players written`);
