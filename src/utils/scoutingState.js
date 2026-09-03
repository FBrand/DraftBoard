/**
 * Scouting overlay state — personal tags/rank/notes on draft prospects.
 * Stored in localStorage under key 'scouting_overlay_v1', entirely separate
 * from the rankings CSV (players' own overallRank/group/etc.). Kept as a
 * standalone overlay, joined against the live `players` list by name at
 * render time (see nameMatcher.js), so reloading rankings data (new CSV
 * drop, corrections) never touches or invalidates these annotations.
 */
import { parseCsvLine, csvField } from './csvUtils';

const STORAGE_KEY = 'scouting_overlay_v1';

export function makeEntry(name, position) {
    return { name, position, tag: null, personalRank: null, notes: '', updatedAt: new Date().toISOString() };
}

export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.version === 1 && Array.isArray(parsed.entries)) return parsed;
        }
    } catch { /* ignore */ }
    return { version: 1, entries: [] };
}

export function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function parseCSV(csvText) {
    const lines = csvText
        .trim()
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.toLowerCase().startsWith('#') && !l.toLowerCase().startsWith('name,'));

    const entries = lines.map(line => {
        const [name, position, tag, personalRank, notes, updatedAt] = parseCsvLine(line);
        return {
            name: (name ?? '').trim(),
            position: (position ?? '').trim(),
            tag: tag && tag.trim() ? tag.trim() : null,
            personalRank: personalRank && personalRank.trim() ? parseInt(personalRank, 10) : null,
            notes: notes ?? '',
            updatedAt: updatedAt && updatedAt.trim() ? updatedAt.trim() : new Date().toISOString(),
        };
    }).filter(e => e.name);

    return { version: 1, entries };
}

export function exportCSV(state) {
    const rows = [
        '# Scouting Overlay Export',
        `# Exported: ${new Date().toISOString()}`,
        ['name', 'position', 'tag', 'personalRank', 'notes', 'updatedAt'].map(csvField).join(','),
    ];
    state.entries.forEach(e => {
        rows.push([e.name, e.position, e.tag ?? '', e.personalRank ?? '', e.notes ?? '', e.updatedAt].map(csvField).join(','));
    });
    return rows.join('\n');
}
