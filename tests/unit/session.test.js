import { describe, it, expect, beforeEach } from 'vitest';
import { exportSession, importSession, sessionFilename, SESSION_VERSION } from '../../src/utils/appSession';
import { isOwnedKey, ownedKeys } from '../../src/utils/appStorage';

/**
 * The session bundle — every stage in one file, and back again.
 *
 * Replaces `session.spec.js`, which drove this through the browser: "exports
 * every stage and restores it after a wipe" and "rejects a non-session file
 * without destroying current state". It is a function of storage, so it runs
 * here in milliseconds instead of behind two app boots.
 *
 * The second of those is the one that matters. An import that validates as it
 * writes leaves you with neither the old session nor the new one, and this is
 * the only copy of a whole offseason.
 */
const put = (pairs) => Object.entries(pairs).forEach(([k, v]) => localStorage.setItem(k, v));

// One key from each stage, plus a board (whose key contains its id, so no
// literal list can name it) and a repository collection.
// Every collection is a path under db_, and the handful of settings that are
// not documents are named exactly. There are no other families: the legacy
// per-stage and per-board key prefixes are gone with the code that read them.
const A_SESSION = {
    db_players: '{"p1":{"n":"Fernando Mendoza"}}',
    'db_boards/b1/entries': '{"p1":{"r":1,"w":1}}',
    'db_seasons/s1/charts/rosterState/rows': '{"qb":{"l":"QB","s":[]}}',
    db_draft_state: '{"s1":{"value":{"currentPick":1}}}',
    draft_board_view: 'scouting',
    session_team_v1: 'KC',
};

beforeEach(() => { globalThis.resetStorage(); });

describe('exporting a session', () => {
    it('carries every stage, including the boards no fixed list can name', () => {
        put(A_SESSION);
        const bundle = JSON.parse(exportSession());

        expect(bundle.format).toBe('draftboard-session');
        expect(bundle.version).toBe(SESSION_VERSION);
        expect(Object.keys(bundle.data).sort()).toEqual(Object.keys(A_SESSION).sort());
        expect(bundle.data.scouting_board_v1__board_dan).toBe(A_SESSION.scouting_board_v1__board_dan);
    });

    it('leaves keys the app does not own out of the bundle', () => {
        put({ ...A_SESSION, some_other_app: 'not ours' });
        const bundle = JSON.parse(exportSession());
        expect(bundle.data.some_other_app).toBeUndefined();
    });

    it('names the file by the day it was written', () => {
        expect(sessionFilename()).toMatch(/^draftboard_session_\d{4}-\d{2}-\d{2}\.json$/);
    });
});

describe('importing a session', () => {
    it('round-trips: export, wipe, import, and every stage is back', () => {
        put(A_SESSION);
        const bundle = exportSession();

        globalThis.resetStorage();
        expect(localStorage.length).toBe(0);

        const { restored } = importSession(bundle);
        expect(restored.sort()).toEqual(Object.keys(A_SESSION).sort());
        Object.entries(A_SESSION).forEach(([k, v]) => expect(localStorage.getItem(k)).toBe(v));
    });

    it('clears a stage the incoming file does not mention, rather than leaving the old one', () => {
        // Otherwise importing a session recorded before free agency existed
        // would silently keep whatever free-agency state was in the browser.
        put(A_SESSION);
        const bundle = exportSession();
        const trimmed = JSON.parse(bundle);
        delete trimmed.data.db_draft_state;

        importSession(JSON.stringify(trimmed));
        expect(localStorage.getItem('db_draft_state')).toBeNull();
        expect(localStorage.getItem('db_players')).toBe(A_SESSION.db_players);
    });

    it('ignores keys it does not own rather than writing whatever it is handed', () => {
        importSession(JSON.stringify({
            format: 'draftboard-session',
            version: 1,
            data: { ...A_SESSION, evil_key: 'x' },
        }));
        expect(localStorage.getItem('evil_key')).toBeNull();
        expect(localStorage.getItem('db_players')).toBe(A_SESSION.db_players);
    });
});

describe('a file that is not a session', () => {
    // Every one of these must leave the current session untouched. The app has
    // no other copy.
    const survives = (text, message) => {
        put(A_SESSION);
        expect(() => importSession(text)).toThrow(message);
        Object.entries(A_SESSION).forEach(([k, v]) => expect(localStorage.getItem(k)).toBe(v));
    };

    it('rejects something that is not JSON at all', () => {
        survives('this is not json', /could not parse JSON/);
    });

    it('rejects JSON that is some other app’s file', () => {
        survives(JSON.stringify({ format: 'something-else', data: {} }), /Not a DraftBoard session file/);
    });

    it('refuses a file from a newer version of the app rather than guessing', () => {
        survives(JSON.stringify({ format: 'draftboard-session', version: SESSION_VERSION + 1, data: A_SESSION }),
            /newer than this app supports/);
    });

    it('rejects a session with no data', () => {
        survives(JSON.stringify({ format: 'draftboard-session', version: 1 }), /no data/);
    });

    it('rejects a session whose data is all keys we do not own', () => {
        survives(JSON.stringify({ format: 'draftboard-session', version: 1, data: { nope: 'x' } }),
            /no recognizable DraftBoard data/);
    });
});

describe('which keys the app owns', () => {
    it('claims the fixed ones and the families that grow', () => {
        expect(isOwnedKey('draft_board_view')).toBe(true);
        expect(isOwnedKey('db_players')).toBe(true);
        expect(isOwnedKey('db_boards/b1/entries')).toBe(true);
        expect(isOwnedKey('db_seasons/s1/charts/rosterState/rows')).toBe(true);
        expect(isOwnedKey('some_other_app')).toBe(false);
        // The legacy families are not claimed any more — nothing writes them.
        expect(isOwnedKey('scouting_board_v1__anything')).toBe(false);
    });

    it('enumerates only what is actually present', () => {
        put({ db_players: '{}' });
        expect(ownedKeys()).toEqual(['db_players']);
    });
});
