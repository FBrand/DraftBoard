import React, { useState, useCallback, useEffect } from 'react';
import * as faState from '../utils/faState';
import * as rosterState from '../utils/rosterState';
import { makeSlot, resolvePosition } from '../utils/rosterState';
import DepthChartGrid from './DepthChartGrid';
import { TextPromptDialog } from './Dialogs';
import Menu from './Menu';
import useUndoableState from '../hooks/useUndoableState';
import useEscapeKey from '../hooks/useEscapeKey';

// ── Small quick-add modal — Name + Position only. The shared depth-chart
// shape (makeSlot: {name, zone}) has no room for free-text notes without
// rippling into DepthChartGrid's rendering and the CSV format, so this
// deliberately matches UnrankedModal's simplest fields rather than the
// richer {name, position, notes} shape floated earlier in planning.
function AddCandidateModal({ isOpen, onClose, onAdd }) {
    const [name, setName] = useState('');
    const [position, setPosition] = useState('');
    useEscapeKey(onClose, isOpen);
    if (!isOpen) return null;
    const submit = (e) => {
        e.preventDefault();
        if (!name.trim() || !position.trim()) return;
        onAdd(name.trim(), position.trim().toUpperCase());
        setName(''); setPosition('');
        onClose();
    };
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Add Candidate</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>
                <form onSubmit={submit} className="picks-form">
                    <div className="form-group">
                        <label>Player Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus />
                    </div>
                    <div className="form-group">
                        <label>Position</label>
                        <input type="text" value={position} onChange={e => setPosition(e.target.value)} />
                    </div>
                    <button type="submit" className="save-pill" disabled={!name.trim() || !position.trim()}>Add</button>
                </form>
            </div>
        </div>
    );
}

// Needs + candidates snapshot — not a signing tracker (see faState.js).
// Renders the same DepthChartGrid Roster uses, against FA's own candidate
// pool. Roster's real depth chart is read fresh on every render (cheap,
// always current) purely to compute need indicators — never written to.
export default function FreeAgencyView({ masterPlayers, draftedPlayers, onInfoOpen }) {
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [addPositionPhase, setAddPositionPhase] = useState(null);
    // Same control Roster has: this grid is desktop-wide by design, so on a
    // phone it needs shrinking to be navigable. FA renders the identical
    // DepthChartGrid but was missing it.
    const [zoomLevel, setZoomLevel] = useState(1);

    // Every write goes through setState, so wrapping it here is all undo needs.
    const [state, setState, history] = useUndoableState(
        () => faState.loadState(),
        useCallback(next => faState.saveState(next), []),
    );

    // Free agency opens on last season's roster rather than an empty grid —
    // that's the squad you actually carry into it, and the thing needs are
    // judged against. Only when nothing has been saved yet, so it can never
    // overwrite work; a failure leaves the empty grid rather than blocking.
    const [seeding, setSeeding] = useState(() => !faState.hasSavedState());
    useEffect(() => {
        if (!seeding) return;
        let cancelled = false;
        (async () => {
            const seeded = await faState.ensureSeeded();
            if (!cancelled) {
                if (seeded) history.reset(seeded);
                setSeeding(false);
            }
        })();
        return () => { cancelled = true; };
        // history.reset is stable; the object identity is not.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seeding]);

    const rosterSnapshot = rosterState.loadState();
    const needs = faState.computePositionNeed(rosterSnapshot);
    const openNeeds = Object.entries(needs).filter(([, n]) => n.stillNeed > 0);

    const performMove = useCallback((src, dst) => {
        if (src.posId === dst.posId && src.slotIdx === dst.slotIdx) return;
        setState(prev => {
            const next = { ...prev, depthChart: { ...prev.depthChart }, reserve: [...prev.reserve], cuts: [...prev.cuts] };
            const dc = next.depthChart;
            const displaced = (dst.posId !== '__ir__' && dst.posId !== '__cut__') ? (dc[dst.posId]?.[dst.slotIdx] ?? null) : null;

            if (src.posId === '__ir__') next.reserve.splice(src.slotIdx, 1);
            else if (src.posId === '__cut__') next.cuts.splice(src.slotIdx, 1);
            else { dc[src.posId] = [...(dc[src.posId] ?? [])]; dc[src.posId][src.slotIdx] = null; }

            if (dst.posId === '__ir__') next.reserve.push(src.slot.name);
            else if (dst.posId === '__cut__') next.cuts.push(src.slot.name);
            else { dc[dst.posId] = [...(dc[dst.posId] ?? [])]; dc[dst.posId][dst.slotIdx] = makeSlot(src.slot.name, dst.targetZone); }

            if (displaced) {
                if (src.posId === '__ir__') next.reserve.push(displaced.name);
                else if (src.posId === '__cut__') next.cuts.push(displaced.name);
                else dc[src.posId][src.slotIdx] = makeSlot(displaced.name, src.slot?.zone ?? '53');
            }
            return next;
        });
    }, [setState]);

    const performRowMove = useCallback((srcIdx, srcPhase, dstIdx, dstPhase) => {
        if (isNaN(srcIdx)) return;
        setState(prev => {
            const next = { ...prev, positionConfig: { ...prev.positionConfig } };
            const srcList = [...next.positionConfig[srcPhase]];
            const [moved] = srcList.splice(srcIdx, 1);
            if (srcPhase === dstPhase) {
                srcList.splice(dstIdx, 0, moved);
                next.positionConfig[srcPhase] = srcList;
            } else {
                const dstList = [...next.positionConfig[dstPhase]];
                dstList.splice(dstIdx, 0, moved);
                next.positionConfig[srcPhase] = srcList;
                next.positionConfig[dstPhase] = dstList;
            }
            return next;
        });
    }, [setState]);

    const handleDeletePosition = (phase, posId) => {
        setState(prev => ({
            ...prev,
            positionConfig: { ...prev.positionConfig, [phase]: prev.positionConfig[phase].filter(x => x.id !== posId) },
        }));
    };

    const handleSlotsChange = (id, val) => {
        setState(prev => {
            const next = { ...prev, positionConfig: { ...prev.positionConfig } };
            ['offense', 'defense'].forEach(p => {
                next.positionConfig[p] = next.positionConfig[p].map(x => x.id === id ? { ...x, slots53: val } : x);
            });
            return next;
        });
    };

    const handleAddPosition = (label) => {
        const phase = addPositionPhase;
        const id = `${phase[0].toUpperCase()}-${label}-${Date.now()}`;
        setState(prev => ({
            ...prev,
            positionConfig: { ...prev.positionConfig, [phase]: [...prev.positionConfig[phase], { id, label, slots53: 2 }] },
        }));
        setAddPositionPhase(null);
    };

    // Additive only: adds any Roster position row FA doesn't already have
    // (matched by label), never touches rows FA already has candidates in.
    const handleSyncPositionsFromRoster = () => {
        const snap = rosterState.loadState();
        if (!snap) return;
        setState(prev => {
            const next = { ...prev, positionConfig: { offense: [...prev.positionConfig.offense], defense: [...prev.positionConfig.defense] }, depthChart: { ...prev.depthChart } };
            ['offense', 'defense'].forEach(phase => {
                (snap.positionConfig[phase] ?? []).forEach(p => {
                    const exists = next.positionConfig[phase].some(x => x.label === p.label);
                    if (!exists) {
                        // Matches parseCSV's own `${phase}-${label}-0` id convention (see
                        // rosterState.js) — a random-suffixed id round-trips fine in-app
                        // but gets renamed to this on the next CSV export/re-import,
                        // which is harmless (ids are never displayed) but avoidable.
                        const id = `${phase[0].toUpperCase()}-${p.label}-0`;
                        next.positionConfig[phase].push({ id, label: p.label, slots53: p.slots53 });
                        next.depthChart[id] = [];
                    }
                });
            });
            return next;
        });
    };

    const handleAddCandidate = (name, position) => {
        setState(prev => {
            let rowId = resolvePosition(position, prev.positionConfig, prev.depthChart);
            const next = { ...prev, positionConfig: { ...prev.positionConfig }, depthChart: { ...prev.depthChart } };
            if (!rowId) {
                const isDefense = ['ED', 'DT', 'DE', 'LB', 'CB', 'S', 'NT'].includes(position);
                const phase = isDefense ? 'defense' : 'offense';
                rowId = `${phase[0].toUpperCase()}-${position}-${Date.now()}`;
                next.positionConfig[phase] = [...next.positionConfig[phase], { id: rowId, label: position, slots53: 2 }];
                next.depthChart[rowId] = [];
            }
            const arr = [...(next.depthChart[rowId] ?? [])];
            let idx = arr.findIndex(s => !s);
            if (idx === -1) idx = arr.length;
            arr[idx] = makeSlot(name, '53');
            next.depthChart[rowId] = arr;
            return next;
        });
    };

    const handleExport = () => {
        const csv = faState.exportCSV(state);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'fa_candidates.csv';
        a.click();
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        // reset, not setState: undoing back into the file you just replaced
        // would be surprising rather than useful.
        history.reset(faState.parseCSV(text));
    };

    return (
        <div className="roster-view">
            <div className="top-panel">
                <div className="roster-brand">
                    <span className="roster-brand-name">FREE AGENCY</span>
                    <span className="roster-brand-sub">NEEDS &amp; CANDIDATES</span>
                </div>

                <div style={{ flex: 1 }} />

                {openNeeds.length > 0 && (
                    <div className="roster-zoom-ctrl" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {openNeeds.map(([label, n]) => (
                            <span key={label} className="rv-ctrl-btn" style={{ width: 'auto', padding: '2px 8px', cursor: 'default' }}>
                                {label} ({n.stillNeed})
                            </span>
                        ))}
                    </div>
                )}

                <div style={{ flex: 1 }} />

                <div className="roster-zoom-ctrl">
                    <button
                        onClick={() => setZoomLevel(z => Math.max(0.5, +(z - 0.1).toFixed(2)))}
                        className="rv-ctrl-btn"
                        title="Zoom out"
                    >−</button>
                    <span className="rv-zoom-label">{Math.round(zoomLevel * 100)}%</span>
                    <button
                        onClick={() => setZoomLevel(z => Math.min(1, +(z + 0.1).toFixed(2)))}
                        className="rv-ctrl-btn"
                        title="Zoom in"
                    >+</button>
                </div>

                <div className="top-actions">
                    <button
                        onClick={history.undo}
                        disabled={!history.canUndo}
                        className="action-pill undo-pill"
                        title="Undo the last change"
                    >Undo</button>
                    <button onClick={() => setIsAddOpen(true)} className="action-pill">+ Add Candidate</button>
                    <Menu items={[
                        { label: 'Import Positions from Roster', onClick: handleSyncPositionsFromRoster, title: 'Adds any position row Roster has that FA doesn\'t' },
                        { label: 'Export Candidates CSV…', onClick: handleExport },
                        { label: 'Import Candidates CSV…', file: { accept: '.csv', onFile: handleImport } },
                    ]} />
                </div>
            </div>

            <DepthChartGrid
                positionConfig={state.positionConfig}
                depthChart={state.depthChart}
                reserve={state.reserve}
                cuts={state.cuts}
                masterPlayers={masterPlayers}
                draftedPlayers={draftedPlayers}
                onMove={performMove}
                onRowMove={performRowMove}
                onDeletePosition={handleDeletePosition}
                onSlotsChange={handleSlotsChange}
                onAddPosition={setAddPositionPhase}
                showNeeds={false}
                zoomLevel={zoomLevel}
                onInfoOpen={onInfoOpen}
            />

            <AddCandidateModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} onAdd={handleAddCandidate} />

            {addPositionPhase && (
                <TextPromptDialog
                    title={`Add ${addPositionPhase} position`}
                    placeholder="e.g. WR.Z"
                    onSubmit={handleAddPosition}
                    onCancel={() => setAddPositionPhase(null)}
                />
            )}
        </div>
    );
}
