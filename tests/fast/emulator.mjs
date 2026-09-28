/**
 * Talking to the Firestore emulator from a test.
 *
 * The point of these is to let a test assert what is IN THE DATABASE, which
 * the suite has never been able to do. Running anonymously, every write it
 * made was absorbed by the local overlay — by design, that is what lets a
 * viewer mock along — so a test could watch a change appear on screen and
 * learn nothing about whether it had reached the shared store. A rule
 * refusing a write and a rule accepting it looked identical.
 *
 * Reading back through `doc()` is the difference. It goes to the emulator
 * over REST with the owner token, which bypasses rules, so it sees exactly
 * what is stored and nothing the browser believes.
 */
const HOST = process.env.EMULATOR_HOST ?? '127.0.0.1:8080';
const AUTH_HOST = process.env.AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const PROJECT = process.env.EMULATOR_PROJECT ?? 'demo-draftboard';

const DOCS = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;

/** The emulator's rules bypass. Not a secret, and only reachable locally. */
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

/** Whether anything is listening. A reachable port is all this proves. */
export async function emulatorUp() {
    try {
        const res = await fetch(`http://${HOST}/`, { signal: AbortSignal.timeout(2000) });
        return res.status > 0;
    } catch {
        return false;
    }
}

/**
 * Empties both emulators.
 *
 * One call each, and the Firestore one takes subcollections with it — which
 * a document-by-document wipe does not, without listing every parent first.
 * Auth is cleared too, or a uid minted by an earlier run survives into the
 * next and `authors/{uid}` starts disagreeing with who is signed in.
 */
export async function resetEmulator() {
    const a = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    if (!a.ok) throw new Error(`Firestore emulator wipe failed (HTTP ${a.status})`);
    const b = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
    // Auth may legitimately be absent; reads do not need it.
    if (!b.ok && b.status !== 404) throw new Error(`Auth emulator wipe failed (HTTP ${b.status})`);
}

/** One stored document, as plain values. Null when it is not there. */
export async function doc(path) {
    const res = await fetch(`${DOCS}/${path}`, { headers: OWNER });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Reading ${path} failed (HTTP ${res.status})`);
    return plain((await res.json()).fields);
}

/** Every document in a collection, keyed by id. */
export async function collection(path) {
    const out = {};
    let token = '';
    do {
        const res = await fetch(`${DOCS}/${path}?pageSize=300${token ? `&pageToken=${token}` : ''}`, { headers: OWNER });
        if (!res.ok) throw new Error(`Listing ${path} failed (HTTP ${res.status})`);
        const body = await res.json();
        (body.documents ?? []).forEach(d => { out[d.name.split('/').pop()] = plain(d.fields); });
        token = body.nextPageToken ?? '';
    } while (token);
    return out;
}

/** Writes a document, bypassing rules. For arranging a test's preconditions. */
export async function put(path, fields) {
    const res = await fetch(`${DOCS}:commit`, {
        method: 'POST',
        headers: OWNER,
        body: JSON.stringify({
            writes: [{ update: { name: `projects/${PROJECT}/databases/(default)/documents/${path}`, fields: encode(fields) } }],
        }),
    });
    if (!res.ok) throw new Error(`Writing ${path} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
}

/**
 * Makes an email an expert.
 *
 * `isExpert()` is a google.com provider, a verified email, and a row here —
 * see firestore.rules. The row is what the harness cannot get any other way:
 * creating one demands the caller name themselves as the inviter, so the
 * first expert on an empty project can only ever be written from outside.
 */
export async function inviteExpert(email) {
    await put(`email2author/${email.toLowerCase()}`, { invitedBy: 'test-harness', invitedAt: new Date().toISOString() });
}

/**
 * Signs the page in as an expert, through the hook the emulator build
 * exposes. Returns the uid, which is also the author id.
 */
export async function signInAsExpert(page, email) {
    await inviteExpert(email);
    const who = await page.evaluate(
        (e) => globalThis.__testSignIn({ email: e }),
        email,
    );
    return who;
}

// --- value encoding, the same shape the seeder uses -------------------------

function encode(obj) {
    const fields = {};
    Object.entries(obj ?? {}).forEach(([k, v]) => { fields[k] = value(v); });
    return fields;
}

function value(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    // Array.from rather than map: a sparse array's holes must become nulls
    // rather than being skipped. See the seeder for what that cost once.
    if (Array.isArray(v)) return { arrayValue: { values: Array.from(v, value) } };
    return { mapValue: { fields: encode(v) } };
}

function plain(fields) {
    const out = {};
    Object.entries(fields ?? {}).forEach(([k, v]) => { out[k] = unwrap(v); });
    return out;
}

function unwrap(v) {
    if (!v || typeof v !== 'object') return v;
    if ('nullValue' in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('stringValue' in v) return v.stringValue;
    if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(unwrap);
    if ('mapValue' in v) return plain(v.mapValue.fields);
    return v;
}
