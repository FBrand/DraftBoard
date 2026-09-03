import React, { useState } from 'react';

const TAGS = [
    { id: 'like', label: '✓ Like' },
    { id: 'avoid', label: '✗ Avoid' },
    { id: 'monitor', label: '? Monitor' },
];

// Small edit panel for one player's scouting entry — tag, personal rank,
// notes. Deliberately not baked into PlayerCard.jsx (shared/memoized across
// Draft/Roster/RightPanel — editing it risks regressing all three).
//
// Local text-input state (personalRank/notes) intentionally resets when the
// selected player changes — the caller renders this with `key={player.name}`
// so React remounts it on selection change rather than syncing state via
// an effect (see https://react.dev/learn/you-might-not-need-an-effect).
export default function ScoutingControls({ player, entry, onChange, onClose }) {
    const [personalRank, setPersonalRank] = useState(entry?.personalRank ?? '');
    const [notes, setNotes] = useState(entry?.notes ?? '');

    if (!player) return null;

    const commit = (patch) => {
        onChange({
            name: player.name,
            position: player.position,
            tag: entry?.tag ?? null,
            personalRank: entry?.personalRank ?? null,
            notes: entry?.notes ?? '',
            ...patch,
            updatedAt: new Date().toISOString(),
        });
    };

    const valueGap = (player.overallRank != null && entry?.personalRank != null)
        ? player.overallRank - entry.personalRank
        : null;

    return (
        <div className="scouting-controls">
            <div className="scouting-controls-header">
                <div>
                    <strong>{player.name}</strong>
                    <span className="scouting-controls-pos"> — {player.position}</span>
                </div>
                <button className="close-btn" onClick={onClose}>&times;</button>
            </div>

            <div className="scouting-controls-tags">
                {TAGS.map(t => (
                    <button
                        key={t.id}
                        className={`scouting-tag-btn ${entry?.tag === t.id ? 'active' : ''}`}
                        onClick={() => commit({ tag: entry?.tag === t.id ? null : t.id })}
                    >{t.label}</button>
                ))}
            </div>

            <div className="scouting-controls-row">
                <label>
                    Personal rank
                    <input
                        type="number"
                        value={personalRank}
                        onChange={e => setPersonalRank(e.target.value)}
                        onBlur={() => commit({ personalRank: personalRank === '' ? null : parseInt(personalRank, 10) })}
                    />
                </label>
                {valueGap != null && (
                    <span className={`scouting-value-gap ${valueGap > 0 ? 'positive' : valueGap < 0 ? 'negative' : ''}`}>
                        {valueGap > 0 ? `+${valueGap} value` : valueGap < 0 ? `${valueGap} reach` : 'at consensus'}
                    </span>
                )}
            </div>

            <textarea
                className="scouting-controls-notes"
                placeholder="Notes..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => commit({ notes })}
            />
        </div>
    );
}
