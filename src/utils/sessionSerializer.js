/**
 * Serializes the current draft state into a robust CSV format with metadata headers.
 */
export const serializeDraftState = (draftedPlayers, ourPicksLeft) => {
    const timestamp = new Date().toISOString();
    const headers = ["overall", "player", "position", "team"];

    let csv = `# DraftBoard Session Export\n`;
    csv += `# Exported: ${timestamp}\n`;
    csv += `# OurPicksLeft: ${ourPicksLeft.join(",")}\n`;
    csv += headers.join(",") + "\n";

    draftedPlayers.forEach(p => {
        const row = [
            p.pickNumber || "",
            `"${(p.name || "").replace(/"/g, '""')}"`,
            `"${(p.position || "").replace(/"/g, '""')}"`,
            `"${(p.team || "").replace(/"/g, '""')}"`
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
                        .filter(n => !isNaN(n));
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

        const pickNumber = parseInt(parts[0], 10);
        if (isNaN(pickNumber)) return;

        const name = (parts[1] || "").replace(/^"|"$/g, "").replace(/""/g, '"');
        const position = (parts[2] || "").replace(/^"|"$/g, "").replace(/""/g, '"');
        const team = (parts[3] || "").replace(/^"|"$/g, "").replace(/""/g, '"');

        draftedPlayers.push({
            name: name || "Unknown Player",
            position: position || "",
            pickNumber,
            team: team || "-",
            drafted: true,
            draftedByUs: false // Will be reconciled by the hook
        });
    });

    // Sort by pick number
    draftedPlayers.sort((a, b) => a.pickNumber - b.pickNumber);

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
    return `Chiefs_Draft_${date}_${time}.csv`;
};
