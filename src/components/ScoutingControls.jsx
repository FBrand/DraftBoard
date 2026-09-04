import React, { useState } from 'react';

const TAGS = [
    { id: 'like', label: '✓ Like' },
    { id: 'avoid', label: '✗ Avoid' },
    { id: 'monitor', label: '? Monitor' },
];

const NUMBER_FIELDS = [
    { key: 'personalRank', label: 'Total Rank' },
    { key: 'positionRank', label: 'Position Rank' },
    { key: 'athleticMatrixTotal', label: 'Athletic Matrix (Total)' },
    { key: 'athleticMatrixPosition', label: 'Athletic Matrix (Pos)' },
];

const LIST_FIELDS = [
    { key: 'strengths', label: 'Strengths' },
    { key: 'weaknesses', label: 'Weaknesses' },
    { key: 'notes', label: 'Notes' },
];

// Small "add a bullet, remove a bullet" list editor — used for
// strengths/weaknesses/notes, which are all the same shape.
function BulletListEditor({ label, items, onChange }) {
    const [draft, setDraft] = useState('');

    const add = () => {
        const v = draft.trim();
        if (!v) return;
        onChange([...(items ?? []), v]);
        setDraft('');
    };

    return (
        <div className="scouting-list-field">
            <div className="scouting-list-label">{label}</div>
            {items?.length > 0 && (
                <ul className="scouting-bullet-list">
                    {items.map((item, i) => (
                        <li key={i}>
                            <span>{item}</span>
                            <button type="button" onClick={() => onChange(items.filter((_, x) => x !== i))} aria-label={`Remove ${label.toLowerCase()} item`}>&times;</button>
                        </li>
                    ))}
                </ul>
            )}
            <div className="scouting-list-add">
                <input
                    type="text"
                    value={draft}
                    placeholder={`Add ${label.toLowerCase()}...`}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                />
                <button type="button" onClick={add}>+</button>
            </div>
        </div>
    );
}

// Player info/scouting panel — rendered as a persistent right-side panel
// (matches Draft's LeftPanel/RightPanel convention) rather than a floating
// fixed-position overlay, which is what it was before and read as randomly
// parked in a corner regardless of what else was on screen.
//
// Local numeric-input state intentionally resets when the selected player
// changes — the caller renders this with `key={player.name}` so React
// remounts it on selection change rather than syncing state via an effect
// (see https://react.dev/learn/you-might-not-need-an-effect).
export default function ScoutingControls({ player, entry, onChange, onClose, boardLabel, onPrevBoard, onNextBoard }) {
    const [numbers, setNumbers] = useState({
        personalRank: entry?.personalRank ?? '',
        positionRank: entry?.positionRank ?? '',
        athleticMatrixTotal: entry?.athleticMatrixTotal ?? '',
        athleticMatrixPosition: entry?.athleticMatrixPosition ?? '',
    });
    const [group, setGroup] = useState(entry?.group ?? '');

    if (!player) {
        return (
            <div className="side-panel right-panel">
                <h3 className="panel-title">Player Info</h3>
                <div className="scouting-empty">Select a player to view or edit scouting notes.</div>
            </div>
        );
    }

    const commit = (patch) => {
        onChange({
            name: player.name,
            position: player.position,
            tag: entry?.tag ?? null,
            group: entry?.group ?? null,
            personalRank: entry?.personalRank ?? null,
            positionRank: entry?.positionRank ?? null,
            athleticMatrixTotal: entry?.athleticMatrixTotal ?? null,
            athleticMatrixPosition: entry?.athleticMatrixPosition ?? null,
            strengths: entry?.strengths ?? [],
            weaknesses: entry?.weaknesses ?? [],
            notes: entry?.notes ?? [],
            ...patch,
            updatedAt: new Date().toISOString(),
        });
    };

    return (
        <div className="side-panel right-panel">
            <div className="scouting-controls-header">
                <div>
                    <strong>{player.name}</strong>
                    <span className="scouting-controls-pos"> — {player.position}</span>
                </div>
                <button className="close-btn" onClick={onClose}>&times;</button>
            </div>

            {boardLabel && (
                <div className="scouting-board-pager">
                    <button type="button" onClick={onPrevBoard} aria-label="Previous board">‹</button>
                    <span>{boardLabel}'s Evaluation</span>
                    <button type="button" onClick={onNextBoard} aria-label="Next board">›</button>
                </div>
            )}

            <div className="panel-content scroll-container">
                <div className="scouting-controls-tags">
                    {TAGS.map(t => (
                        <button
                            key={t.id}
                            className={`scouting-tag-btn ${entry?.tag === t.id ? 'active' : ''}`}
                            onClick={() => commit({ tag: entry?.tag === t.id ? null : t.id })}
                        >{t.label}</button>
                    ))}
                </div>

                <label className="scouting-group-field">
                    Round.Group
                    <input
                        type="text"
                        value={group}
                        placeholder="e.g. 1.3"
                        onChange={e => setGroup(e.target.value)}
                        onBlur={() => commit({ group: group.trim() || null })}
                    />
                </label>

                <div className="scouting-number-grid">
                    {NUMBER_FIELDS.map(f => (
                        <label key={f.key}>
                            {f.label}
                            <input
                                type="number"
                                value={numbers[f.key]}
                                onChange={e => setNumbers(n => ({ ...n, [f.key]: e.target.value }))}
                                onBlur={() => commit({ [f.key]: numbers[f.key] === '' ? null : parseInt(numbers[f.key], 10) })}
                            />
                        </label>
                    ))}
                </div>

                {LIST_FIELDS.map(f => (
                    <BulletListEditor
                        key={f.key}
                        label={f.label}
                        items={entry?.[f.key] ?? []}
                        onChange={items => commit({ [f.key]: items })}
                    />
                ))}
            </div>
        </div>
    );
}
