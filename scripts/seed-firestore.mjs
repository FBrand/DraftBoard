/**
 * Puts the shipped season into Firestore, once, from outside the app.
 *
 * The app does not do this any more and must not. Auto-seeding is a
 * single-user affordance: on localStorage it is how the thing bootstraps, and
 * it is correct. Against a shared database it is every client, unbidden,
 * trying to write a season from files it happens to ship with — refused for a
 * viewer, kept locally anyway, and the result is each browser holding a
 * private copy of a board the database never had. Two rules refuse it outright
 * and rightly: an author may only be created keyed by the caller's own uid,
 * and an invite may only name the caller as its inviter. Seeding has to
 * impersonate Dan and Ryan, so it can never work from a browser.
 *
 * So it happens here, with credentials that may actually write it, and the
 * deployed build no longer carries the CSVs at all (see the withhold step in
 * .github/workflows/deploy.yml).
 *
 * WHY IT RUNS THE APP'S OWN CODE. Every document shape here — the short field
 * names, the id scheme, the float spacing inside a tier, which board gets an
 * author and which does not — is decided by src/. A script that rebuilt those
 * shapes would be a second implementation of them, and it would drift on the
 * first rename. Instead this points the app at an in-memory backend, runs the
 * real openBoards() and the real seedBoard(), and then uploads whatever the
 * repository ends up holding. If the shapes change, this follows for free.
 *
 * That is also why it is run through vite-node rather than node: the app's
 * imports are extensionless and only Vite's resolver answers them.
 *
 *   # read-only, prints what it would write
 *   npm run seed:firestore -- --project warroomsuite --dry-run
 *
 *   # for real
 *   npm run seed:firestore -- --project warroomsuite --key ./service-account.json
 *
 * GETTING THE KEY: Firebase console -> Project settings -> Service accounts ->
 * Generate new private key. It bypasses security rules entirely, which is the
 * point and also why it must never be committed — add it to .gitignore or keep
 * it outside the repo.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function args(argv) {
    const out = { dryRun: false, project: null, key: null, boards: 'faithful', wipe: false, host: null, chunk: 500 };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--dry-run') out.dryRun = true;
        else if (a === '--wipe') out.wipe = true;
        else if (a === '--project') out.project = argv[++i];
        else if (a === '--key') out.key = argv[++i];
        else if (a === '--host') out.host = argv[++i];
        else if (a === '--chunk') out.chunk = Number(argv[++i]);
        else if (a === '--boards') out.boards = argv[++i];
        else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    }
    if (!out.project) throw new Error('--project is required (e.g. --project warroomsuite)');
    if (!['faithful', 'public'].includes(out.boards)) {
        throw new Error("--boards must be 'faithful' (consensus shared, the analysts' orphaned) or 'public' (all shared)");
    }
    // Against the emulator there is no key and no need of one: it accepts the
    // literal bearer token "owner" and applies no rules to it. That is the
    // documented local-development door, and it is the whole reason the test
    // harness can seed a project it has no credentials for.
    if (!out.dryRun && !out.key && !out.host) {
        throw new Error('--key <service-account.json> is required unless --dry-run or --host. Rules forbid seeding from a user session: see the header.');
    }
    return out;
}

const opts = args(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Access token, from a service-account key
//
// Signed here rather than with firebase-admin, which is not a dependency of
// this project and would be a large one to add for an operation that is two
// HTTP calls. The assertion is the documented JWT bearer flow.
// ---------------------------------------------------------------------------

const b64url = (buf) => Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function accessToken(keyPath) {
    const key = JSON.parse(readFileSync(keyPath, 'utf8'));
    if (!key.client_email || !key.private_key) {
        throw new Error(`${keyPath} does not look like a service-account key (no client_email / private_key).`);
    }
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: key.client_email,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    };
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    const jwt = `${unsigned}.${b64url(signer.sign(key.private_key))}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    });
    const body = await res.json();
    if (!res.ok || !body.access_token) {
        throw new Error(`Could not get an access token (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 200)}`);
    }
    return body.access_token;
}

// ---------------------------------------------------------------------------
// Firestore REST
//
// A service-account token is not subject to security rules, which is the only
// way the two impersonating writes can happen at all.
// ---------------------------------------------------------------------------

/** A JS value as a Firestore Value. */
function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
        return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (typeof v === 'string') return { stringValue: v };
    // Array.from, not map: a depth chart row keeps its empty slots as HOLES
    // (rosterSync assigns arr[i] directly), and map skips a hole rather than
    // calling the mapper on it. The hole then survives into JSON.stringify as
    // a bare null, which is not a Firestore Value — the real service shrugs
    // and takes it, the emulator refuses the whole commit with "Payload isn't
    // valid for request" and names nothing. Array.from visits holes as
    // undefined, so they become the nullValue an empty slot should be.
    if (Array.isArray(v)) return { arrayValue: { values: Array.from(v, toValue) } };
    if (typeof v === 'object') {
        const fields = {};
        Object.entries(v).forEach(([k, x]) => { fields[k] = toValue(x); });
        return { mapValue: { fields } };
    }
    throw new Error(`Cannot store ${typeof v}`);
}

const toFields = (doc) => {
    const fields = {};
    Object.entries(doc ?? {}).forEach(([k, v]) => { fields[k] = toValue(v); });
    return fields;
};

/**
 * Writes documents in batches, addressed by their full path.
 *
 * Each write is an upsert, but that does NOT make the script idempotent: the
 * ids come from the app's own generator and are fresh every run, so a second
 * run adds a second season, a second set of boards and 328 more player
 * records rather than replacing the first. Player duplicates are the damaging
 * one — the registry exists to stop one man having two records.
 *
 * So this is a ONE-SHOT tool for an empty project, and --wipe is how you get
 * an empty project. 500 writes is the documented per-commit ceiling.
 */
/** Where Firestore lives: the real service, or an emulator on this machine. */
function documentsBase(project, host) {
    return host
        ? `http://${host}/v1/projects/${project}/databases/(default)/documents`
        : `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
}

async function commitAll(project, token, writes, { dryRun, host, chunk: size = 500 }) {
    const base = documentsBase(project, host);
    if (dryRun) return;
    for (let i = 0; i < writes.length; i += size) {
        const chunk = writes.slice(i, i + size);
        const res = await fetch(`${base}:commit`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                writes: chunk.map(w => ({
                    update: {
                        name: `projects/${project}/databases/(default)/documents/${w.path}`,
                        fields: toFields(w.doc),
                    },
                })),
            }),
        });
        if (!res.ok) {
            const body = (await res.text()).slice(0, 200);
            // Name what was in the batch. "Payload isn't valid" about 500
            // anonymous documents is not a diagnosis, and bisecting by hand
            // is how an afternoon goes.
            const kinds = [...new Set(chunk.map(w => w.path.split('/').slice(0, -1).join('/')
                .replace(/^boards\/[^/]+\/entries$/, 'boards/*/entries')
                .replace(/^evaluations\/[^/]+\/remarks$/, 'evaluations/*/remarks')
                .replace(/^seasons\/[^/]+\//, 'seasons/*/')))];
            // Find the document the store actually objected to, by sending
            // them one at a time. A batch rejection names nothing, and the
            // alternative is bisecting 500 documents by hand.
            let culprit = null;
            for (const w of chunk) {
                const one = await fetch(`${base}:commit`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ writes: [{ update: {
                        name: `projects/${project}/databases/(default)/documents/${w.path}`,
                        fields: toFields(w.doc),
                    } }] }),
                });
                if (!one.ok) { culprit = { w, detail: (await one.text()).slice(0, 200) }; break; }
            }
            throw new Error(
                `Commit failed (HTTP ${res.status}) on documents ${i}-${i + chunk.length - 1}: ${body}\n`
                + `  collections in this batch: ${kinds.join(', ')}\n`
                + (culprit
                    ? `  REFUSED: ${culprit.w.path}\n  doc: ${JSON.stringify(culprit.w.doc).slice(0, 400)}\n  SENT: ${JSON.stringify(toFields(culprit.w.doc)).slice(0, 700)}\n  said: ${culprit.detail}`
                    : '  no single document reproduced it — the batch itself is the problem (size? 500 limit?)'),
            );
        }
        process.stdout.write(`  committed ${Math.min(i + size, writes.length)}/${writes.length}\n`);
    }
}

/**
 * Empties the collections this script owns, including every board's entries.
 *
 * Needed because the ids are fresh each run: without it a second seeding sits
 * alongside the first and the registry ends up holding two records for every
 * player, which is the exact failure the registry was built to prevent.
 *
 * Only the collections listed here, and deliberately NOT email2author — the
 * real experts' invites live there, and deleting one revokes a person's
 * access. The two mock invites this script writes are upserted over instead.
 */
async function wipe(project, token, { dryRun, host }) {
    // The emulator can empty a whole database in one call, and does it
    // properly — subcollections included, which the document-by-document
    // path below does not reach without listing every parent. Against the
    // real service there is no such endpoint, so that path stays.
    if (host) {
        console.log('Wipe: clearing the emulator database.');
        if (dryRun) return;
        const res = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Emulator wipe failed (HTTP ${res.status})`);
        return;
    }
    const base = documentsBase(project, null);
    const list = async (collection) => {
        const names = [];
        let pageToken = '';
        do {
            const url = `${base}/${collection}?pageSize=300&fields=documents.name,nextPageToken${pageToken ? `&pageToken=${pageToken}` : ''}`;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) throw new Error(`Could not list ${collection} (HTTP ${res.status})`);
            const j = await res.json();
            (j.documents ?? []).forEach(d => names.push(d.name));
            pageToken = j.nextPageToken ?? '';
        } while (pageToken);
        return names;
    };

    // Boards first, so their entries can be reached while the board ids are
    // still known.
    const boardNames = await list('boards');
    const targets = [...boardNames];
    for (const n of boardNames) {
        const id = n.split('/').pop();
        targets.push(...await list(`boards/${id}/entries`));
    }
    for (const c of ['seasons', 'authors', 'players']) targets.push(...await list(c));

    console.log(`Wipe: ${targets.length} documents (boards, their entries, seasons, authors, players).`);
    console.log('       email2author is left alone — real invites live there.');
    if (dryRun || !targets.length) return;

    for (let i = 0; i < targets.length; i += 500) {
        const chunk = targets.slice(i, i + 500);
        const res = await fetch(`${base}:commit`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ writes: chunk.map(name => ({ delete: name })) }),
        });
        if (!res.ok) throw new Error(`Delete failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
        process.stdout.write(`  deleted ${Math.min(i + 500, targets.length)}/${targets.length}\n`);
    }
}

/**
 * Serves public/ over fetch, so the app's own seeding paths work unchanged.
 *
 * Every one of them reaches for its file with fetch(`${import.meta.env.BASE_URL}`
 * + name) — loadFiles, playerFacts, the roster and free-agency snapshots, the
 * example evaluations, the completed draft. In node there is no server and no
 * base URL, so rather than reimplement six loaders, this answers them from
 * disk.
 *
 * Anything not under public/ gets a 404 rather than a thrown error, because
 * that is what those callers are written against: loadFiles caches null on a
 * failed fetch, playerFacts treats a non-ok response as no rows. A throw would
 * take paths down that are built to cope.
 */
function servePublicOverFetch() {
    const real = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const url = String(input?.url ?? input);
        // Absolute URLs are the real thing (the OAuth token endpoint).
        if (/^https?:\/\//.test(url)) return real(input, init);
        const name = url.split("/").filter(Boolean).pop() ?? "";
        const file = `${ROOT}/public/${name}`;
        if (!name || !existsSync(file)) {
            return new Response("not found", { status: 404, statusText: "Not Found" });
        }
        return new Response(readFileSync(file), { status: 200 });
    };
    return () => { globalThis.fetch = real; };
}

// ---------------------------------------------------------------------------
// Build the season by running the app against an in-memory store
// ---------------------------------------------------------------------------

async function build() {
    const restoreFetch = servePublicOverFetch();
    try {
    const { repository } = await import(`${ROOT}/src/data/repository.js`);

    // The backend has to be memory, and it has to be set in the ENVIRONMENT
    // before vite-node starts — see the npm script. Assigning process.env in
    // here does nothing: import.meta.env is resolved when Vite transforms the
    // module, not when it runs, so the app would build the adapter .env.local
    // names and this script would sit there reading the live project and
    // logging permission-denied, which is exactly what it did first time.
    if (repository.adapter?.name !== 'memory') {
        throw new Error(
            `Expected the memory backend, got "${repository.adapter?.name}". `
            + 'Run this through "npm run seed:firestore", which sets VITE_BACKEND=memory.',
        );
    }
    const { openBoards, listBoards, currentSeason } = await import(`${ROOT}/src/utils/boardRegistry.js`);
    const { parseRankings } = await import(`${ROOT}/src/utils/dataParser.js`);
    const { resolveAll, openRegistry, PLAYERS } = await import(`${ROOT}/src/utils/playerRegistry.js`);
    const { seedBoard } = await import(`${ROOT}/src/utils/scoutingState.js`);
    const { entriesPath } = await import(`${ROOT}/src/data/boardEntries.js`);
    const { applyPlayerFacts } = await import(`${ROOT}/src/utils/playerFacts.js`);
    const { seedExampleEvaluations } = await import(`${ROOT}/src/utils/exampleEvaluations.js`);
    const faState = await import(`${ROOT}/src/utils/faState.js`);
    const rosterState = await import(`${ROOT}/src/utils/rosterState.js`);
    const { writeDraft, DRAFT_STATE } = await import(`${ROOT}/src/data/draftStore.js`);
    const { deserializeDraftState } = await import(`${ROOT}/src/utils/sessionSerializer.js`);
    const { reconcileDraft } = await import(`${ROOT}/src/utils/draftReconcile.js`);
    const { highestDraftPick } = await import(`${ROOT}/src/utils/draftPhase.js`);

    // openBoards() is the thing that knows what the shipped season IS: one
    // season, three boards, an author and a mock invite for each analyst, and
    // consensus deliberately author-less. Running it rather than restating it
    // is the whole point of this script.
    await openRegistry();
    await openBoards();

    const season = currentSeason();
    if (!season) throw new Error('openBoards() produced no season — the app changed shape; read it before trusting this script.');

    const boards = listBoards();
    if (!boards.length) throw new Error('openBoards() produced no boards.');

    // Each file, parsed. The union across them is what every board carries:
    // a player one analyst ranked and another did not is UNRANKED on the
    // second board, not missing from it, or there is nowhere to disagree.
    const parsed = new Map();
    for (const b of boards) {
        if (!b.rankingsFile) continue;
        const file = `${ROOT}/public/${b.rankingsFile}`;
        if (!existsSync(file)) throw new Error(`Missing ${file}. The CSVs stay in the repo even though the build withholds them.`);
        parsed.set(b.id, (parseRankings(readFileSync(file, 'utf8')) || []).filter(p => p?.name));
    }

    // The union, joined on NAME — deliberately not on name+position. Analysts
    // label the same player DL and EDGE all the time, and joining on position
    // splits one man into two. This mirrors useBoardRankings.joinKeyFor; it is
    // the one piece of logic restated here rather than imported, because that
    // one lives inside a React hook.
    const union = new Map();
    for (const [, rows] of parsed) {
        for (const p of rows) {
            const key = String(p.name).trim().toLowerCase();
            if (!union.has(key)) union.set(key, { name: p.name, position: p.position ?? '', school: p.school ?? '' });
            else {
                const held = union.get(key);
                if (!held.position && p.position) held.position = p.position;
                if (!held.school && p.school) held.school = p.school;
            }
        }
    }

    // One registry record per player, minted by the app's own resolver so the
    // ids and the alias handling are the real ones.
    const cast = [...union.values()];
    const ids = resolveAll(cast);
    const idByName = new Map();
    cast.forEach((p, i) => { if (ids[i]) idByName.set(String(p.name).trim().toLowerCase(), ids[i]); });

    // Every board gets the whole cast, overlaid with its own file's placements.
    for (const b of boards) {
        const own = new Map();
        (parsed.get(b.id) ?? []).forEach(p => own.set(String(p.name).trim().toLowerCase(), p));

        const pool = cast.map((p) => {
            const key = String(p.name).trim().toLowerCase();
            const mine = own.get(key);
            return {
                ...p,
                id: idByName.get(key) ?? null,
                // Absent from this analyst's file means unranked here, which is
                // a null round rather than a bad one.
                round: mine?.round ?? null,
                tier: mine?.tier ?? null,
                isFavorite: mine?.isFavorite ?? false,
                tag: mine?.tag ?? null,
            };
        });
        seedBoard(b.id, pool);
    }

    // ---- the other stages -------------------------------------------------
    //
    // The boards are not the season. Withholding the CSVs stopped the facts,
    // the roster, free agency, the completed draft and the example
    // evaluations from seeding too, so all five belong here or the project
    // comes up with three boards and four empty stages.

    // Facts first: school and draft outcome go onto the registry records the
    // boards just created, and everything below reads players.
    await applyPlayerFacts();

    // Free agency is the pre-draft roster — what the offseason starts from.
    // ensureSeeded does the fetch, the parse and the write, and knows which
    // season it belongs to.
    await faState.ensureSeeded();

    // The roster is the day before cutdown. RosterView does this on its
    // bootstrap screen; there is no view here, so the two calls it makes are
    // made directly.
    if (rosterState.loadState() === null) {
        rosterState.saveState(await rosterState.fetchLocalRoster());
    }

    // The completed draft. This is the one piece of orchestration that is
    // restated rather than imported, because in the app it lives inside
    // useDraftState and a hook cannot be called here. It is the same three
    // steps: deserialize the file, join it against the pool id-first, and
    // set the next pick from the highest one recorded. UDFA rows carry the
    // literal string rather than a number, which is why the pick counter
    // comes from highestDraftPick and not from Math.max over the column.
    const picksFile = `${ROOT}/public/DraftBoard_Picks.csv`;
    if (existsSync(picksFile)) {
        const imported = deserializeDraftState(readFileSync(picksFile, "utf8"));
        if (imported.draftedPlayers.length || imported.ourPicksLeft.length) {
            // The playerIds in the file are STALE and must be thrown away.
            //
            // DraftBoard_Picks.csv is an export, so it carries the ids the
            // registry had when it was written. Seeding mints fresh ones, and
            // nothing connects the two. Left in place they are worse than
            // absent: writeDraft looks for records to hang the picks on with
            // factsFor(id), gets nothing for an id that belongs to no player,
            // and skips that pick without a word — all 257 of them. The draft
            // then has a pick counter saying it finished and not one pick in
            // it, which is exactly what the board showed.
            //
            // Dropped rather than remapped, so the join below resolves every
            // pick by name against the registry that actually exists now.
            const fromFile = imported.draftedPlayers.map(({ playerId, ...rest }) => rest);
            const poolForDraft = cast.map((p, i) => ({ ...p, id: ids[i] ?? null }));
            const { draftedPlayers } = reconcileDraft(poolForDraft, fromFile);
            // Anybody the pool could not account for keeps no id, and
            // writeDraft mints him — a UDFA or a player from another class is
            // a real pick and has to end up in the registry, not dropped.
            const unresolved = draftedPlayers.filter(d => !d.playerId && !d.id).length;
            if (unresolved) console.log(`  ${unresolved} picks had no pool match; writeDraft will register them.`);
            writeDraft(season.id, {
                draftedPlayers,
                ourPicksLeft: imported.ourPicksLeft,
                currentPick: (highestDraftPick(draftedPlayers) ?? 0) + 1,
                remotePicks: [],
            });
        }
    }

    // Remarks on the consensus board, so a card is not blank on a fresh
    // project. Needs the boards, which is why it is last.
    await seedExampleEvaluations();

    // Whatever the app ended up holding, as paths.
    const writes = [];
    // Every collection the run produced, rather than a list written out here:
    // the list silently omitted whatever the app gained since it was written,
    // which is how four stages got left out of the first version of this.
    for (const collection of repository.collections()) {
        const docs = repository.docs(collection) ?? {};
        Object.entries(docs).forEach(([id, doc]) => {
            if (doc) writes.push({ path: `${collection}/${id}`, doc });
        });
    }
    // Optional flattening: make every board shared rather than leaving the
    // analysts' boards orphaned. Orphaned is the faithful shape — a personal
    // board nobody has claimed — and it is what lets Dan claim his own when he
    // signs in. The cost is that until he does, NOBODY can write its entries
    // (an orphaned board is readable by any expert and writable by none), so
    // if you want the boards editable by any expert immediately, pass
    // --boards public and accept that they can then never be owned.
    if (opts.boards === 'public') {
        writes.forEach(w => {
            if (w.path.startsWith('boards/') && w.path.split('/').length === 2) {
                w.doc = { ...w.doc, a: null };
            }
        });
    }

    return { writes, season, boards };
    } finally {
        restoreFetch();
    }
}

// ---------------------------------------------------------------------------

const { writes, season, boards } = await build();

// Grouped by the COLLECTION a document sits in, not by its first path
// segment. Counting by the first segment filed the roster chart, the free
// agency chart and the setup markers all under "seasons", which read as 56
// season documents and hid whether the stages had seeded at all.
const counts = writes.reduce((acc, w) => {
    const parts = w.path.split('/');
    const key = parts.slice(0, -1).join('/')
        // One line per KIND of thing rather than one per board or per player.
        .replace(/^boards\/[^/]+\/entries$/, 'boards/*/entries')
        .replace(/^evaluations\/[^/]+\/remarks$/, 'evaluations/*/remarks')
        .replace(/^seasons\/[^/]+\//, 'seasons/*/');
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
}, {});

console.log(`\nSeason ${season.year} (${season.id}), ${boards.length} boards, ownership: ${opts.boards}`);
boards.forEach(b => console.log(`  ${b.slug.padEnd(10)} author=${b.authorId ?? 'none (shared)'} owner=${b.ownerId ?? 'none'}`));
console.log('\nDocuments:');
Object.entries(counts).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));
console.log(`  ${String(writes.length).padStart(5)}  TOTAL\n`);

if (opts.dryRun) {
    // One per collection rather than the first three, which were all seasons
    // and authors and told you nothing about the shape of an entry.
    if (opts.wipe) {
        // Listing the target needs the credentials a dry run does not have.
        console.log('--wipe was passed and CANNOT be previewed: listing what would be');
        console.log('deleted requires the key. Re-run without --dry-run to perform it.');
    }
    console.log('--dry-run: nothing written. One sample per collection:');
    const seen = new Set();
    writes.forEach((w) => {
        const kind = w.path.includes('/entries/') ? 'entries' : w.path.split('/')[0];
        if (seen.has(kind)) return;
        seen.add(kind);
        console.log(`  ${w.path}\n    ${JSON.stringify(w.doc)}`);
    });
    process.exit(0);
}

const token = opts.host ? 'owner' : await accessToken(opts.key);
if (opts.wipe) await wipe(opts.project, token, { dryRun: false, host: opts.host });
console.log(`Writing to ${opts.project}${opts.host ? ` (emulator at ${opts.host})` : ''}...`);
await commitAll(opts.project, token, writes, { dryRun: false, host: opts.host, chunk: opts.chunk });
console.log('Done.');
