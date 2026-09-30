import { repository } from '../../src/data/repository';
import { openBoards } from '../../src/utils/boardRegistry';
import { seedInitialBoards } from '../../scripts/seed/initialBoards';

/**
 * A seeded store for a test that needs one.
 *
 * `openBoards()` used to do this: it loaded the board records and created a
 * season and three boards if it found none, so every test got a seeded app for
 * free by calling the loader. That convenience was the defect — the function that
 * decided the store was empty also wrote the defaults into it, and every
 * silent-overwrite bug on this project came out of that pairing.
 *
 * Seeding is the seeder's now. A test that wants a seeded store asks for one, in
 * as many words, which is also what the app does: it hydrates from a snapshot the
 * seeder built (data/hydrate.js) before anything renders.
 *
 * Deliberately imported from `scripts/`, and it should look odd. These tests are
 * exercising the app against data somebody else produced, and the import path is
 * the reminder of which side of that line the seeding is on.
 */
export async function seedApp() {
    await openBoards();          // loads; writes nothing
    await seedInitialBoards();
    repository.invalidate();     // written underneath the caches openBoards filled
    await openBoards();
}
