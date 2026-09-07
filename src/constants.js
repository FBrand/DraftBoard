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
 * How many picks each round has.
 *
 * A round cannot be divided out of a pick number: compensatory picks make the
 * rounds uneven from the third on, so `ceil(pick / 32)` is wrong for most of
 * a draft. Stated as counts rather than cumulative boundaries because counts
 * are what a draft order is published as, and what somebody would type in.
 *
 * These are the ACTUAL 2026 order, taken from the completed draft rather than
 * assumed — a generic [32, 32, 38, 37, 38, 39, 41] was wrong from the third
 * round on and would have called pick 101 a third-rounder. They move every
 * year as compensatory picks are awarded, so experts set them in Settings; see
 * appSettings.getRoundSizes().
 */
export const DEFAULT_ROUND_SIZES = [32, 32, 36, 40, 41, 35, 41];

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
