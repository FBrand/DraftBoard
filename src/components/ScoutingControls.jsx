import React, { useState } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';

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
// strengths/weaknesses/notes, which are all the same shape. When readOnly,
// renders the bullets as plain text (and nothing at all when empty) rather
// than showing disabled inputs, which would be visual noise in a card whose
// whole job is to be read.
function BulletListEditor({ label, items, onChange, readOnly }) {
    const [draft, setDraft] = useState('');

    const add = () => {
        const v = draft.trim();
        if (!v) return;
        onChange([...(items ?? []), v]);
        setDraft('');
    };

    if (readOnly && !items?.length) return null;

    return (
        <div className="scouting-list-field">
            <div className="scouting-list-label">{label}</div>
            {items?.length > 0 && (
                <ul className="scouting-bullet-list">
                    {items.map((item, i) => (
                        <li key={i}>
                            <span>{item}</span>
                            {!readOnly && (
                                <button type="button" onClick={() => onChange(items.filter((_, x) => x !== i))} aria-label={`Remove ${label.toLowerCase()} item`}>&times;</button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {!readOnly && (
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
            )}
        </div>
    );
}

// Player info/scouting panel. Two presentations of the same fields:
// variant="panel" (default) is Scouting's own persistent right-side column
// (matches Draft's LeftPanel/RightPanel convention) rather than the floating
// fixed-position overlay this used to be, which read as randomly parked in a
// corner regardless of what else was on screen. variant="modal" is the same
// content as a centered dialog — used outside Scouting (Draft/UDFA) where a
// right-click or long-press on any card opens this without a dedicated
// column to put it in; see PlayerInfoModal.jsx.
//
// Local numeric-input state intentionally resets when the selected player
// changes — the caller renders this with `key={player.name}` so React
// remounts it on selection change rather than syncing state via an effect
// (see https://react.dev/learn/you-might-not-need-an-effect).
export default function ScoutingControls({ player, entry, onChange, onClose, boardLabel, onPrevBoard, onNextBoard, variant = 'panel', readOnly = false }) {
    const [numbers, setNumbers] = useState({
        personalRank: entry?.personalRank ?? '',
        positionRank: entry?.positionRank ?? '',
        athleticMatrixTotal: entry?.athleticMatrixTotal ?? '',
        athleticMatrixPosition: entry?.athleticMatrixPosition ?? '',
    });
    const [group, setGroup] = useState(entry?.group ?? '');
    // Only the modal presentation is dismissable — the panel variant is a
    // permanent column, not something Escape should blank out.
    useEscapeKey(onClose, variant === 'modal' && !!player);

    if (!player) {
        if (variant === 'modal') return null;
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

    // Read-only cards show only what's actually filled in, so an untouched
    // player would otherwise render as an empty box with no explanation.
    const hasAnyContent = !!(
        entry && (
            entry.tag || entry.group != null ||
            NUMBER_FIELDS.some(f => entry[f.key] != null && entry[f.key] !== '') ||
            LIST_FIELDS.some(f => entry[f.key]?.length)
        )
    );

    const content = (
        <div className={variant === 'modal' ? 'side-panel right-panel scouting-modal-box' : 'side-panel right-panel'}>
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
                {readOnly ? (
                    entry?.tag && (
                        <div className="scouting-controls-tags">
                            <span className="scouting-tag-btn active scouting-tag-static">
                                {TAGS.find(t => t.id === entry.tag)?.label ?? entry.tag}
                            </span>
                        </div>
                    )
                ) : (
                    <div className="scouting-controls-tags">
                        {TAGS.map(t => (
                            <button
                                key={t.id}
                                className={`scouting-tag-btn ${entry?.tag === t.id ? 'active' : ''}`}
                                onClick={() => commit({ tag: entry?.tag === t.id ? null : t.id })}
                            >{t.label}</button>
                        ))}
                    </div>
                )}

                {readOnly ? (
                    // Round.Group is omitted here — it's a board-building
                    // control, not a scouting read-out. The four numbers
                    // always show, falling back to "?" so an unevaluated
                    // player reads as "not rated yet" rather than silently
                    // dropping the field.
                    <div className="scouting-readonly-grid">
                        {NUMBER_FIELDS.map(f => {
                            const val = entry?.[f.key];
                            const isSet = val != null && val !== '';
                            return (
                                <div key={f.key} className="scouting-readonly-field">
                                    <span className="scouting-readonly-label">{f.label}</span>
                                    <span className={`scouting-readonly-value${isSet ? '' : ' unset'}`}>
                                        {isSet ? val : '?'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <>
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
                    </>
                )}

                {LIST_FIELDS.map(f => (
                    <BulletListEditor
                        key={f.key}
                        label={f.label}
                        items={entry?.[f.key] ?? []}
                        onChange={items => commit({ [f.key]: items })}
                        readOnly={readOnly}
                    />
                ))}

                {readOnly && !hasAnyContent && (
                    <div className="scouting-empty">
                        Not scouted yet — add notes in the Scouting tab.
                    </div>
                )}
            </div>
        </div>
    );

    if (variant === 'modal') {
        return (
            <div className="modal-overlay" onClick={onClose}>
                <div onClick={e => e.stopPropagation()}>{content}</div>
            </div>
        );
    }
    return content;
}
