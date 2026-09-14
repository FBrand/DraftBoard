import { defineConfig, devices } from '@playwright/test';

// The sweep. Not part of `npm test`, on purpose.
//
// It LOOKS for things rather than asserting them: content escaping the
// viewport, controls with no accessible name, text spilling out of its own
// box, console errors, every stage at four widths. That makes it a tool for
// a person to read, not a gate for a pipeline — it passes while reporting
// problems, which is exactly what a regression test must never do.
//
// It also costs about 1.7 minutes, which is a third of the budget for
// something that cannot fail. Run it deliberately:
//
//     npm run test:audit:docker
import baseConfig from './playwright.fast.config.js';

export default defineConfig({
    ...baseConfig,
    testDir: './tests/audit',
    projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } }],
});
