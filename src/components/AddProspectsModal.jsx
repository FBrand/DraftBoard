import React, { useState, useRef, useMemo } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';
import { classify, parseProspectCSV, CSV_TEMPLATE } from '../utils/prospects';
import { PLAYER_TAGS } from '../utils/playerTags';

/**
 * Adding prospects, in two steps.
 *
 * Step 1 gets the names down fast — the live case is an analyst watching a
 * game, hearing a name he doesn't have, and wanting it on the board before the
 * next snap. Name, position, school; Tab across, Enter for the next row.
 *
 * Step 2 verifies. BOTH entry paths land here — typed rows and an imported
 * CSV — and nothing is written until it is submitted, so an import is a
 * proposal rather than a bulk write you have to clean up afterwards. A CSV
 * may carry the enrichment columns too, in which case it arrives prefilled.
 *
 * Each player gets three rows: who he is, his numbers, and what you make of
 * him. The whole batch is on screen at once, so adding one player is the same
 * screen as adding twelve, just shorter.
 */

// The same symbols the scouting card marks remarks with (see LIST_FIELDS in
// ScoutingControls) — a strength has to read as a strength wherever it is
// written, not only where it is displayed.
const BULLETS = [
    { key: 'strengths', label: 'Add strength', symbol: '+', cls: 'strength' },
    { key: 'weaknesses', label: 'Add weakness', symbol: '−', cls: 'weakness' },
    { key: 'notes', label: 'Add note', symbol: '•', cls: 'note' },
];

const NUMBERS = [
    { key: 'round', label: 'Round' },
    { key: 'tier', label: 'Tier' },
    { key: 'rank', label: 'Total Rank' },
    { key: 'matrixTotal', label: 'Matrix Total' },
    { key: 'matrixPosition', label: 'Matrix Pos' },
];

const blankRow = (seed = {}) => ({
    name: '', position: '', school: '',
    tag: null, round: '', tier: '', rank: '', matrixTotal: '', matrixPosition: '',
    strengths: [], weaknesses: [], notes: [],
    // Set once the analyst has said a fuzzy match is a different player.
    keepDespiteMatch: false,
    ...seed,
});

// A CSV cell for a field the form renders as a choice, not free text.
const seedTag = (raw) => {
    const v = String(raw ?? '').trim().toLowerCase();
    return PLAYER_TAGS.some(t => t.id === v) ? v : null;
};

export default function AddProspectsModal({ isOpen, onClose, existingPlayers = [], onSubmit, onOpenPlayer }) {
    const [step, setStep] = useState('entry');
    const [rows, setRows] = useState(() => [blankRow(), blankRow(), blankRow()]);
    const [error, setError] = useState('');
    const nameRefs = useRef([]);

    useEscapeKey(onClose, isOpen);

    const setRow = (i, patch) => setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

    const filled = rows.filter(r => r.name.trim());

    // ---- step 1: entry -----------------------------------------------------

    const isEmptyRow = (r) => !r.name.trim() && !r.position.trim() && !r.school.trim();

    const focusName = (i) => requestAnimationFrame(() => nameRefs.current[i]?.focus());

    const handleEntryKeyDown = (e, i) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        // Enter on a row you haven't typed anything into means "that's all of
        // them" — the same gesture as pressing the button, without reaching
        // for the mouse.
        if (isEmptyRow(rows[i])) return toVerify();
        if (i === rows.length - 1) {
            setRows(prev => [...prev, blankRow()]);
            focusName(i + 1);
        } else {
            focusName(i + 1);
        }
    };

    const toVerify = () => {
        if (!filled.length) return setError('Add at least one player.');
        setError('');
        setRows(filled);
        setStep('verify');
    };

    const handleCSV = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const parsed = parseProspectCSV(await file.text());
        if (!parsed.length) {
            return setError('No players found in that file. Expected name,position,school on each line.');
        }
        // Straight to verification: an import proposes, it doesn't commit.
        setRows(parsed.map(p => blankRow({ ...p, tag: seedTag(p.tag) })));
        setError('');
        setStep('verify');
    };

    const downloadTemplate = () => {
        const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'prospects_template.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    // ---- step 2: verification ----------------------------------------------

    // Each row is checked against the board AND against the rows above it, so
    // the same name typed twice in one batch is caught the same way as a name
    // that is already on the board. Filling in a different position or school
    // is itself a resolution — it says these are two different men.
    const verdicts = useMemo(() => {
        if (step !== 'verify') return [];
        const seen = [];
        return rows.map(r => {
            const against = [...existingPlayers, ...seen];
            // Qualified by the whole identity: a name already on the board is
            // only the SAME player if the position and school don't say
            // otherwise. Two men with one name do turn up in a single class.
            const v = classify(r.name, against, r);
            seen.push({ name: r.name.trim(), position: r.position, school: r.school });
            return v;
        });
    }, [rows, existingPlayers, step]);

    const blockedCount = verdicts.filter((v, i) => (
        (v.kind === 'exact' || (v.kind === 'similar' && !rows[i].keepDespiteMatch))
    )).length;

    const removeRow = (i) => setRows(prev => prev.filter((_, j) => j !== i));

    const addBullet = (i, key) => setRow(i, { [key]: [...rows[i][key], ''] });
    const setBullet = (i, key, j, value) =>
        setRow(i, { [key]: rows[i][key].map((b, k) => (k === j ? value : b)) });
    const removeBullet = (i, key, j) =>
        setRow(i, { [key]: rows[i][key].filter((_, k) => k !== j) });

    const submit = () => {
        if (blockedCount) return;
        onSubmit(rows.map(r => ({
            ...r,
            name: r.name.trim(),
            position: r.position.trim().toUpperCase(),
            school: r.school.trim(),
            strengths: r.strengths.map(s => s.trim()).filter(Boolean),
            weaknesses: r.weaknesses.map(s => s.trim()).filter(Boolean),
            notes: r.notes.map(s => s.trim()).filter(Boolean),
        })));
        onClose();
    };

    const openExisting = (name) => { onOpenPlayer?.(name); onClose(); };

    // After every hook, so the hook order never changes with visibility.
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content add-prospects" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{step === 'entry' ? 'Add Prospects' : `Verify ${rows.length} Player${rows.length === 1 ? '' : 's'}`}</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="ap-error">{error}</div>}

                {step === 'entry' ? (
                    <>
                        <p className="ap-hint">
                            Tab moves between fields, Enter starts the next row. Enter on an
                            empty row moves on to verification.
                        </p>
                        <div className="ap-entry-grid">
                            <span className="ap-col-head">Name</span>
                            <span className="ap-col-head">Position</span>
                            <span className="ap-col-head">School</span>
                            {rows.map((r, i) => (
                                <React.Fragment key={i}>
                                    <input
                                        ref={el => { nameRefs.current[i] = el; }}
                                        className="text-input" value={r.name} autoFocus={i === 0}
                                        placeholder="Player name"
                                        onChange={e => setRow(i, { name: e.target.value })}
                                        onKeyDown={e => handleEntryKeyDown(e, i)}
                                    />
                                    <input
                                        className="text-input" value={r.position} placeholder="e.g. EDGE"
                                        onChange={e => setRow(i, { position: e.target.value })}
                                        onKeyDown={e => handleEntryKeyDown(e, i)}
                                    />
                                    <input
                                        className="text-input" value={r.school} placeholder="e.g. Georgia"
                                        onChange={e => setRow(i, { school: e.target.value })}
                                        onKeyDown={e => handleEntryKeyDown(e, i)}
                                    />
                                </React.Fragment>
                            ))}
                        </div>

                        <div className="modal-actions ap-actions">
                            <label className="action-button secondary ap-file">
                                Import CSV…
                                <input type="file" accept=".csv" onChange={handleCSV} hidden />
                            </label>
                            <button type="button" className="action-button secondary" onClick={downloadTemplate}>
                                CSV template
                            </button>
                            <div style={{ flex: 1 }} />
                            <button type="button" className="action-button secondary" onClick={onClose}>Cancel</button>
                            <button type="button" className="action-button primary" onClick={toVerify}>
                                Review {filled.length || ''}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="ap-verify-list">
                            {rows.map((r, i) => {
                                const v = verdicts[i];
                                const blocked = v?.kind === 'exact' || (v?.kind === 'similar' && !r.keepDespiteMatch);
                                return (
                                    <div key={i} className={`ap-player ${blocked ? 'blocked' : ''}`}>
                                        {/* row 1 — who he is */}
                                        <div className="ap-row ap-row-base">
                                            <input className="text-input ap-name" value={r.name} placeholder="Player name"
                                                onChange={e => setRow(i, { name: e.target.value })} />
                                            <input className="text-input ap-pos" value={r.position} placeholder="Pos"
                                                onChange={e => setRow(i, { position: e.target.value })} />
                                            <input className="text-input ap-school" value={r.school} placeholder="School"
                                                onChange={e => setRow(i, { school: e.target.value })} />
                                            <div className="ap-tags">
                                                {PLAYER_TAGS.map(t => (
                                                    <button
                                                        key={t.id} type="button" title={t.title}
                                                        className={`ap-tag-btn ${r.tag === t.id ? 'active' : ''}`}
                                                        onClick={() => setRow(i, { tag: r.tag === t.id ? null : t.id })}
                                                    >{t.symbol}</button>
                                                ))}
                                            </div>
                                            <button type="button" className="ap-remove" title="Remove this player"
                                                onClick={() => removeRow(i)}>&times;</button>
                                        </div>

                                        {/* row 2 — his numbers */}
                                        <div className="ap-row ap-row-numbers">
                                            {NUMBERS.map(f => (
                                                <label key={f.key} className="ap-num">
                                                    <span>{f.label}</span>
                                                    <input type="number" min="1" className="text-input" value={r[f.key]}
                                                        onChange={e => setRow(i, { [f.key]: e.target.value })} />
                                                </label>
                                            ))}
                                        </div>

                                        {/* row 3 — what you make of him */}
                                        <div className="ap-row ap-row-remarks">
                                            {BULLETS.map(b => (
                                                <button key={b.key} type="button"
                                                    className={`ap-add-btn ${b.cls}`}
                                                    onClick={() => addBullet(i, b.key)}>
                                                    <span className="ap-add-symbol" aria-hidden="true">{b.symbol}</span>
                                                    {b.label}
                                                </button>
                                            ))}
                                        </div>

                                        {BULLETS.some(b => r[b.key].length > 0) && (
                                            <div className="ap-bullets">
                                                {BULLETS.map(b => r[b.key].map((text, j) => (
                                                    <div key={`${b.key}-${j}`} className={`ap-bullet ${b.cls}`}>
                                                        <span className="ap-bullet-symbol" aria-label={b.label}>{b.symbol}</span>
                                                        <input className="text-input" value={text} autoFocus
                                                            placeholder={b.label.replace('Add ', '')}
                                                            onChange={e => setBullet(i, b.key, j, e.target.value)} />
                                                        <button type="button" className="ap-remove"
                                                            onClick={() => removeBullet(i, b.key, j)}>&times;</button>
                                                    </div>
                                                )))}
                                            </div>
                                        )}

                                        {v?.kind === 'exact' && (
                                            <div className="ap-collision">
                                                <span>
                                                    <strong>{v.match.name}</strong>
                                                    {v.match.position ? ' (' + v.match.position + ')' : ''} is already
                                                    on the board. A different position or school makes him a
                                                    different player.
                                                </span>
                                                <button type="button" className="ap-link"
                                                    onClick={() => openExisting(v.match.name)}>Open his card</button>
                                                <button type="button" className="ap-link"
                                                    onClick={() => removeRow(i)}>Drop this row</button>
                                            </div>
                                        )}
                                        {v?.kind === 'similar' && !r.keepDespiteMatch && (
                                            <div className="ap-collision">
                                                <span>Looks like <strong>{v.match.name}</strong>{v.match.position ? ` (${v.match.position})` : ''}.</span>
                                                <button type="button" className="ap-link"
                                                    onClick={() => openExisting(v.match.name)}>Same player — open his card</button>
                                                <button type="button" className="ap-link"
                                                    onClick={() => setRow(i, { keepDespiteMatch: true })}>Different player — keep</button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="modal-actions ap-actions">
                            <button type="button" className="action-button secondary" onClick={() => setStep('entry')}>
                                Back
                            </button>
                            <div style={{ flex: 1 }} />
                            {blockedCount > 0 && (
                                <span className="ap-blocked-note">
                                    {blockedCount} name{blockedCount === 1 ? '' : 's'} still to resolve
                                </span>
                            )}
                            <button type="button" className="action-button primary"
                                disabled={blockedCount > 0 || !rows.length} onClick={submit}>
                                Add {rows.length} to board
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
