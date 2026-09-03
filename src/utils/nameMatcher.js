const NICKNAME_MAP = {
    "kc": "kevin",
    "tj": "t",
    "dj": "d",
    "cj": "c",
    "aj": "a",
    "jj": "j",
    "rj": "r",
    "vj": "v",
    // Can add more here
};

// 1. Punctuation & space normalization
function normalizeString(name) {
    if (!name) return "";
    return name.toLowerCase()
        .replace(/[.,'´`-]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// 2. Suffix stripping
function stripSuffix(name) {
    // Remove jr, sr, ii, iii, iv if they are at the end of the string
    return name.replace(/\s+(jr|sr|ii|iii|iv)$/g, "").trim();
}

// 3. Nickname mapping on the first name
function applyNickname(name) {
    const parts = name.split(" ");
    if (parts.length > 0 && NICKNAME_MAP[parts[0]]) {
        parts[0] = NICKNAME_MAP[parts[0]];
    }
    return parts.join(" ");
}

// 4. Levenshtein Distance
function getLevenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    // Increment along the first column of each row
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    // Increment each column in the first row
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1  // deletion
                    )
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Pre-computes name normalizations for a player list. Callers that look up
 * many names against the same list in a loop (see useDraftState.js) should
 * build this once and reuse it via findMatchingIndex, rather than calling
 * findMatchingPlayerIndex per lookup — that rebuilds this list from scratch
 * every time, which turns an O(N) loop into an accidental O(N*M) one.
 */
export function buildNameIndex(playersList) {
    if (!playersList) return [];
    return playersList.map((p, idx) => {
        const norm = normalizeString(p.name);
        const noSuffix = stripSuffix(norm);
        const nick = applyNickname(noSuffix);
        return { index: idx, name: p.name, norm, noSuffix, nick };
    });
}

/**
 * Finds the index of a player in a pre-built name index (see buildNameIndex),
 * using a cascade of matching strategies.
 */
export function findMatchingIndex(targetName, mappedList) {
    if (!targetName || !mappedList || mappedList.length === 0) return -1;

    // Normalizations for the target
    const targetNorm = normalizeString(targetName);
    const targetNoSuffix = stripSuffix(targetNorm);
    const targetNick = applyNickname(targetNoSuffix);

    // Strategy 1: Exact Match (Normalized Punctuation & Case)
    let match = mappedList.find(p => p.norm === targetNorm);
    if (match) return match.index;

    // Strategy 2: Suffix Stripped Exact Match
    match = mappedList.find(p => p.noSuffix === targetNoSuffix);
    if (match) return match.index;

    // Strategy 3: Nickname Applied Exact Match
    match = mappedList.find(p => p.nick === targetNick);
    if (match) return match.index;

    // Strategy 4: Fallback Contains (using the heavily normalized names)
    match = mappedList.find(p => p.nick.includes(targetNick) || targetNick.includes(p.nick));
    if (match) return match.index;

    // Strategy 5: Similarity Match (Levenshtein)
    // Only accept if distance is <= 2 AND distance ratio is small
    let bestIndex = -1;
    let bestDist = Infinity;

    for (let i = 0; i < mappedList.length; i++) {
        const p = mappedList[i];
        // Levenshtein distance is always >= the length difference between the
        // two strings, and nothing past distance 2 is ever accepted below —
        // so a bigger length gap can be rejected without the O(len*len) scan.
        if (Math.abs(targetNick.length - p.nick.length) > 2) continue;
        const dist = getLevenshteinDistance(targetNick, p.nick);
        if (dist < bestDist) {
            bestDist = dist;
            bestIndex = p.index;
        }
    }

    // Distance 1 or 2 threshold. If it's a short 6 character name, distance 2 is too much (33% diff).
    // Let's cap distance at 2, and require it to be < 20% of the name length or absolute distance of 1.
    if (bestIndex !== -1) {
        if (bestDist === 1 && targetNick.length >= 5) {
            return bestIndex;
        }
        if (bestDist <= 2 && targetNick.length >= 10) {
            return bestIndex;
        }
    }

    return -1;
}

/**
 * Convenience wrapper for one-off lookups against a list. Builds the name
 * index on every call, so it's fine for a single lookup but should NOT be
 * used inside a loop over many names — use buildNameIndex + findMatchingIndex
 * instead in that case.
 */
export function findMatchingPlayerIndex(targetName, playersList) {
    return findMatchingIndex(targetName, buildNameIndex(playersList));
}
