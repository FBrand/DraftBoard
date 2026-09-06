/**
 * Central configuration for the Draft Board.
 * Change these values to re-brand the board for a different team.
 */
/**
 * The draft the app is currently working. Facts recorded during a draft are
 * stamped with it, so a player picked in this session is distinguishable from
 * one drafted three years ago when both sit on the same depth chart.
 */
export const DRAFT_YEAR = 2026;

/**
 * The last overall pick of each round.
 *
 * A round cannot be divided out of a pick number: compensatory picks make the
 * rounds uneven from the third on, so `ceil(pick / 32)` is wrong for most of
 * a draft. These are the standard modern boundaries and are worth checking
 * against the actual order each year — a wrong round is worse than none, so
 * anything past the last boundary gets no round rather than a guessed one.
 */
export const DRAFT_ROUND_ENDS = [32, 64, 102, 139, 177, 216, 257];

export const TEAM_CONFIG = {
    name: "Kansas City Chiefs",
    abbreviation: "KC",
    espnId: "12",
    primaryColor: "#E31837",
    secondaryColor: "#FFB81C",
};

/**
 * Mapping of ESPN Team IDs to abbreviations.
 */
export const TEAM_ID_MAP = {
    "22": "ARI", "1": "ATL", "33": "BAL", "2": "BUF", "29": "CAR", "3": "CHI",
    "4": "CIN", "5": "CLE", "6": "DAL", "7": "DEN", "8": "DET", "9": "GB",
    "34": "HOU", "11": "IND", "30": "JAX", "12": "KC", "24": "LAC", "14": "LAR",
    "13": "LV", "15": "MIA", "16": "MIN", "17": "NE", "18": "NO", "19": "NYG",
    "20": "NYJ", "21": "PHI", "23": "PIT", "26": "SEA", "25": "SF", "27": "TB",
    "10": "TEN", "28": "WSH"
};
