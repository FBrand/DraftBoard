import { pickNumberOf } from './draftPhase';

/**
 * Serializes the current draft state into a robust CSV format with metadata headers.
 */
export const serializeDraftState = (draftedPlayers, ourPicksLeft) => {
    const timestamp = new Date().toISOString();
    // playerId is the registry id, when the pick has one — resolved once at
    // ingestion (see reconcileDraft.js) rather than re-derived by name every
    // time this file is read back in. See pickJoin.js: a pick is joined by
    // this field first, name only as the fallback for a pick that predates
    // it or was never resolved.
    const headers = ["overall", "player", "position", "team", "playerId"];

    let csv = `# DraftBoard Session Export\n`;
    csv += `# Exported: ${timestamp}\n`;
    csv += `# OurPicksLeft: ${ourPicksLeft.join(",")}\n`;
    csv += headers.join(",") + "\n";

    draftedPlayers.forEach(p => {
        const row = [
            p.pickNumber || "",
            `"${(p.name || "").replace(/"/g, '""')}"`,
            `"${(p.position || "").replace(/"/g, '""')}"`,
            `"${(p.team || "").replace(/"/g, '""')}"`,
            `"${(p.playerId || "").replace(/"/g, '""')}"`
        ];
        csv += row.join(",") + "\n";
    });

    return csv;
};

/**
 * Deserializes a CSV string back into draft state objects.
 * Robust against missing columns or incomplete data.
 */
export const deserializeDraftState = (csvText) => {
    const lines = csvText.trim().split("\n");
    let ourPicksLeft = [];
    const draftedPlayers = [];

    lines.forEach(line => {
        line = line.trim();
        if (!line) return;

        // Parse metadata headers
        if (line.startsWith("#")) {
            if (line.includes("OurPicksLeft:")) {
                const parts = line.split("OurPicksLeft:");
                if (parts[1]) {
                    ourPicksLeft = parts[1].split(",")
                        .map(n => parseInt(n.trim(), 10))
                        // A pick is 1 or more. An exhausted draft used to
                        // write "# OurPicksLeft: 0", which read back as a
                        // phantom pick 0 that could never come up and could
                        // never be cleared.
                        .filter(n => Number.isFinite(n) && n > 0);
                }
            }
            return;
        }

        // Skip header row
        if (line.toLowerCase().startsWith("overall,")) return;

        // Parse data rows
        // Simple CSV split (handles quotes roughly)
        const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        if (parts.length < 1) return;

        var pickNumber = parseInt(parts[0], 10);
        if (isNaN(pickNumber)) pickNumber = parts[0];

        const name = (parts[1] || "").replace(/^"|"$/g, "").replace(/""/g, '"');
        const position = (parts[2] || "").replace(/^"|"$/g, "").replace(/""/g, '"');
        const team = (parts[3] || "").replace(/^"|"$/g, "").replace(/""/g, '"');
        // Absent on a file written before this column existed, or a pick
        // that was never resolved to a registry id — either way, absence
        // just means "join by name," the fallback pickJoin.js already has.
        const playerId = (parts[4] || "").replace(/^"|"$/g, "").replace(/""/g, '"') || null;

        draftedPlayers.push({
            name: name || "Unknown Player",
            position: position || "",
            pickNumber,
            team: team || "-",
            playerId,
            drafted: true,
            draftedByUs: false // Will be reconciled by the hook
        });
    });

    // Sort by pick number, and remember that a pick number is not always a
    // number: this format records an undrafted signing with the literal UDFA,
    // which is the whole reason `pickNumber` is kept as a string when it will
    // not parse. `a.pickNumber - b.pickNumber` is NaN for those, and a
    // comparator that returns NaN does not throw — it quietly sorts nothing.
    // A session with any UDFA in it came back in FILE order: picks 3, 1, 2.
    //
    // Through draftPhase, which is where this rule lives: nothing outside it
    // compares a raw pickNumber against a number. Signings sort after every
    // pick and keep their order among themselves, the sort being stable.
    const order = (p) => pickNumberOf(p) ?? Number.MAX_SAFE_INTEGER;
    draftedPlayers.sort((a, b) => order(a) - order(b));

    return {
        draftedPlayers,
        ourPicksLeft
    };
};

/**
 * Generates a filename for the draft export.
 */
export const getExportFilename = () => {
    const now = new Date();
    const date = now.toISOString().split("T")[0];
    const time = now.getHours().toString().padStart(2, "0") + "-" +
        now.getMinutes().toString().padStart(2, "0");
    return `DraftBoard_Session_${date}_${time}.csv`;
};
