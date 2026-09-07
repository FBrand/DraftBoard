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
    },
});
