import { defineConfig } from 'vitest/config';

// Unit tests for the logic half of the app. The browser suite (Playwright,
// tests/*.spec.js) keeps what only a browser can prove: drag-and-drop,
// clipping, stacking contexts, modals. Everything that is a function of
// values — ranking, identity, draft phase, storage — belongs here, where it
// runs in milliseconds instead of a 20-second app boot.
export default defineConfig({
    test: {
        include: ['tests/unit/**/*.test.js'],
        setupFiles: ['tests/unit/setup.js'],
        environment: 'node',

        // The suite talks to NOTHING. Vite loads .env.local for tests the same
        // way it does for a dev server, and that file says
        // VITE_BACKEND=firebase with the emulator variable empty — so this
        // suite was running against the live project. It was slow, it spent
        // real read quota on every run, and 26 of its tests failed on a
        // 10-second hook timeout waiting for repository.ready() to come back
        // over the network. Those read as logic failures and were not.
        //
        // memory rather than local, deliberately. memoryAdapter has no
        // loadSync and says so in its header — which is the property that
        // makes it the right stand-in for a remote store: "this collection
        // has not been read yet" stays distinguishable from "this collection
        // is empty", which is the distinction three of today's bugs turned
        // on. The local adapter fills the cache on read and collapses the
        // two, so a suite on it cannot test the case that keeps breaking.
        //
        // The rules suite is the exception and keeps its own config: it exists
        // to ask what Firestore actually stores, so it needs the emulator.
        env: { VITE_BACKEND: 'memory', VITE_FIREBASE_EMULATOR: '' },
    },
});
