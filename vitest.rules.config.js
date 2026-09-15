import { defineConfig } from 'vitest/config';

/**
 * The rules suite, which needs the Firestore emulator.
 *
 * Kept out of `npm test` on purpose: it needs a JVM and a container, and a
 * suite that cannot run everywhere is a suite that stops being run. The
 * regular unit tests use a twenty-line localStorage double and no environment
 * at all — see tests/README.md.
 */
export default defineConfig({
    test: {
        include: ['tests/rules/**/*.test.js'],
        environment: 'node',
        testTimeout: 20_000,
        hookTimeout: 30_000,
        fileParallelism: false,
    },
});
