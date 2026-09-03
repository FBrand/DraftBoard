// Player names may carry a ":suffix" tag (e.g. "John Doe:UDFA") used to flag
// how a player was added — a draft-pick round number, UDFA, FA, IR, etc.
const SUFFIX_COLORS = {
    UDFA: 'rgba(255, 215, 0, 0.7)', // Gold
    FA: '#3b82f6',                  // Blue
    IR: 'var(--chiefs-red)',
    RP: '#FFD700',                  // Rookie Pick (Gold)
};

export function parseName(rawName, defaultColor = 'inherit') {
    if (!rawName) return { displayName: '', suffix: '', nameColor: defaultColor };
    const parts = rawName.split(':');
    const displayName = parts[0].trim();
    const suffix = parts[1]?.trim() || '';

    let nameColor = defaultColor;
    if (suffix) {
        if (/^\d+$/.test(suffix)) nameColor = '#FFD700'; // Draft round number
        else if (SUFFIX_COLORS[suffix]) nameColor = SUFFIX_COLORS[suffix];
    }
    return { displayName, suffix, nameColor };
}
