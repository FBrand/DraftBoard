import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { remarksPath } from '../../src/utils/evaluations';
import { entriesPath } from '../../src/data/boardEntries';
import { rowsPath, bandsPath } from '../../src/data/depthChartStore';
import { stagesPath } from '../../src/data/stageStore';
import { setupPath } from '../../src/utils/seasonInit';

/**
 * Every address the app writes has a rule that reaches it.
 *
 * `firestore.rules` ends in a deny-all, which is the right way round: a
 * collection added later is unreachable until somebody writes a rule for it,
 * so the failure is a permission error in development rather than an open
 * database in production.
 *
 * The cost of that is silent in the other direction. Move a collection — and
 * this app moved nearly all of them — and the rule keeps matching the old
 * address while the app writes the new one. Nothing fails until it is
 * deployed, and then everything does. `draft_state` was already in that state:
 * no rule named it, so it fell to the deny-all and the draft could not be
 * written at all.
 *
 * There is no emulator here, so this cannot prove a rule ALLOWS the right
 * person. It proves the weaker thing that actually rots: that some rule is
 * reachable for every path the app uses.
 */
const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

/**
 * The match statements, as segment patterns, with nesting resolved.
 *
 * A `match` inside a `match` is a path relative to its parent, which is how
 * `boards/{id}` and its `entries` subcollection are written.
 */
function rulePatterns(text) {
    const out = [];
    const stack = [];          // { depth, segs }
    let depth = 0;

    text.split('\n').forEach(raw => {
        const line = raw.replace(/\/\/.*$/, '');
        const open = line.match(/match\s+(\S+)/);

        // Count braces rather than looking for a lone `}`. The helper
        // functions at the top of the file close with one too, and popping on
        // those left the stack describing a nesting that does not exist.
        const opens = (line.match(/\{/g) ?? []).length;
        const closes = (line.match(/\}/g) ?? []).length;
        // A path segment is written {playerId}; those braces are not nesting.
        const pathBraces = open ? (open[1].match(/\{/g) ?? []).length : 0;

        if (open) {
            const segs = open[1].split('/').filter(Boolean);
            stack.push({ depth, segs });
            out.push(stack.flatMap(f => f.segs));
        }

        depth += (opens - pathBraces) - (closes - pathBraces);
        while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    });

    // Drop the `databases/{database}/documents` wrapper from every pattern.
    return out
        .filter(p => p.length > 3)
        .map(p => p.slice(3));
}

/** Does this pattern reach this path? `{x}` is one segment, `{x=**}` is many. */
function reaches(pattern, segments) {
    for (let i = 0; i < pattern.length; i += 1) {
        const token = pattern[i];
        if (/^\{.*=\*\*\}$/.test(token)) return segments.length >= i;
        if (i >= segments.length) return false;
        if (/^\{.*\}$/.test(token)) continue;
        if (token !== segments[i]) return false;
    }
    return pattern.length === segments.length;
}

const patterns = rulePatterns(RULES);
const covered = (path) => {
    const segs = path.split('/').filter(Boolean);
    // The deny-all reaches everything, so it is excluded: what is being asked
    // is whether a rule OTHER than the floor names this path.
    return patterns
        .filter(p => !(p.length === 1 && /=\*\*\}$/.test(p[0])))
        .some(p => reaches(p, segs));
};

/** A document path: the collection plus one more segment. */
const doc = (collectionPath) => `${collectionPath}/anId`;

const WRITES = {
    'the player registry': doc('players'),
    'authors': doc('authors'),
    'the season stack': doc('seasons'),
    'board records': doc('boards'),
    'a board’s placements': doc(entriesPath('b_1')),
    'depth-chart rows': doc(rowsPath('rosterState', 's_1')),
    'depth-chart bands': doc(bandsPath('fa_state_v1', 's_1')),
    'stage blobs': doc(stagesPath('s_1')),
    'the setup markers': doc(setupPath('s_1')),
    'a remark': doc(remarksPath('p_1')),
    'the draft state': doc('draft_state'),
};

describe('the rules reach every address the app writes', () => {
    it('found the match statements at all', () => {
        // If this breaks, the parse is wrong and every assertion below is
        // passing for the wrong reason.
        expect(patterns.length).toBeGreaterThan(5);
        expect(patterns.some(p => p[0] === 'players')).toBe(true);
    });

    Object.entries(WRITES).forEach(([what, path]) => {
        it(`covers ${what} — ${path}`, () => {
            expect(covered(path), `${path} falls through to the deny-all`).toBe(true);
        });
    });

    it('still denies something nobody has written a rule for', () => {
        // The floor is the point of the file. If this passes as "covered",
        // the matcher is too loose and the rest of this suite means nothing.
        expect(covered('something_invented/anId')).toBe(false);
    });

    it('names the owner as a path variable rather than splitting a key', () => {
        // The evaluation rule used to split a composite key to find whose
        // voice it was, and got it wrong: the left half is an AUTHOR id, the
        // lookup went to /boards, found nothing, and every expert could
        // overwrite every other expert's evaluations.
        expect(RULES).toMatch(/match \/evaluations\/\{playerId\}\/remarks\/\{ownerId\}/);
        expect(RULES).not.toMatch(/evaluationId\.split/);
    });
});
