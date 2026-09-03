import React, { useState, useCallback } from 'react';
import {
    loadState, saveState, defaultState,
    parseCSV, exportCSV, makeSlot, resolvePosition,
    SPECIALIST_IDS, hasRosterSourceAdapter, fetchAdapterRoster, fetchLocalRoster, parseHTMLToRoster
} from '../utils/rosterState';
import * as faState from '../utils/faState';
import UnrankedModal from './UnrankedModal';
import DepthChartGrid from './DepthChartGrid';

// ── Small in-app replacements for window.prompt / window.confirm ───────────
function TextPromptDialog({ title, placeholder, onSubmit, onCancel }) {
    const [value, setValue] = useState('');
    return (
        <div className="modal-overlay rv-inline-dialog" onClick={onCancel}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{title}</h2>
                    <button className="close-btn" onClick={onCancel}>&times;</button>
                </div>
                <form onSubmit={e => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
                    <div className="modal-body">
                        <input
                            autoFocus
                            type="text"
                            value={value}
                            placeholder={placeholder}
                            onChange={e => setValue(e.target.value)}
                        />
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="cancel-pill" onClick={onCancel}>Cancel</button>
                        <button type="submit" className="save-pill" disabled={!value.trim()}>Add</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function ConfirmDialog({ title, message, onConfirm, onCancel }) {
    return (
        <div className="modal-overlay rv-inline-dialog" onClick={onCancel}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{title}</h2>
                    <button className="close-btn" onClick={onCancel}>&times;</button>
                </div>
                <div className="modal-body"><p>{message}</p></div>
                <div className="modal-footer">
                    <button className="cancel-pill" onClick={onCancel}>Cancel</button>
                    <button className="save-pill" onClick={onConfirm}>Confirm</button>
                </div>
            </div>
        </div>
    );
}

function CounterBox({ label, val, max, status, isLast, maxLabel }) {
    return (
        <div className={`roster-counter ${isLast ? 'last' : ''}`}>
            <div className="roster-counter-label">{label}</div>
            <div className={`roster-counter-value ${status}`}>{val} <span className="roster-counter-max">/ {maxLabel ?? max}</span></div>
        </div>
    );
}

// ── Main RosterView ────────────────────────────────────────────────────────
// Owns roster state/persistence/CSV/bootstrap; the grid itself (drag-and-drop,
// slots, specialists, IR, cuts) is DepthChartGrid.jsx, shared with Free Agency.
export default function RosterView({ masterPlayers, draftedPlayers, currentPick, onDraft }) {
    const isDraftComplete = (currentPick || 1) > 257;
    const [state, setStateRaw] = useState(() => {
        const loaded = loadState() ?? defaultState();
        if (!loaded.cuts) loaded.cuts = [];
        if (!loaded.reserve) loaded.reserve = [];
        return loaded;
    });
    const [bootstrapping, setBootstrapping] = useState(() => loadState() === null);
    const [isSignModalOpen, setIsSignModalOpen] = useState(false);
    const [isPasting, setIsPasting] = useState(false);
    const [pastedHtml, setPastedHtml] = useState('');
    const [addPositionPhase, setAddPositionPhase] = useState(null); // 'offense' | 'defense' | null
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    // The depth-chart grid is desktop-wide by design (many position columns);
    // on a phone that means horizontal scrolling to reach most slots. `zoom`
    // (not transform:scale, which wouldn't shrink the actual scrollable
    // layout) lets a mobile user shrink the whole grid to fit more on screen.
    const [zoomLevel, setZoomLevel] = useState(1);

    const setState = useCallback(next => {
        setStateRaw(prev => {
            const result = typeof next === 'function' ? next(prev) : next;
            if (result && result.depthChart && result.positionConfig) {
                const normalize = (slots, limit53) => {
                    if (!slots) return [];
                    const newSlots = [];
                    // 1. Keep 53-man slots (indices 0 to limit53 - 1)
                    for (let i = 0; i < limit53; i++) {
                        newSlots[i] = slots[i] || null;
                    }
                    // 2. PS slots (limit53 to limit53 + 2)
                    const psSlots = slots.slice(limit53, limit53 + 3).filter(Boolean);
                    for (let i = 0; i < 3; i++) {
                        newSlots[limit53 + i] = psSlots[i] || null;
                    }
                    // 3. Reserve slots (from limit53 + 3 onwards)
                    const rSlots = slots.slice(limit53 + 3).filter(Boolean);
                    rSlots.forEach((slot, idx) => {
                        newSlots[limit53 + 3 + idx] = slot;
                    });
                    return newSlots;
                };

                const newDC = { ...result.depthChart };
                const allPositions = [
                    ...(result.positionConfig.offense || []),
                    ...(result.positionConfig.defense || [])
                ];
                allPositions.forEach(p => {
                    if (newDC[p.id]) {
                        newDC[p.id] = normalize(newDC[p.id], Math.max(1, p.slots53));
                    }
                });
                result.depthChart = newDC;
            }
            saveState(result);
            return result;
        });
    }, []);

    const handleSignPlayer = (customPlayer) => {
        if (onDraft) onDraft(customPlayer);
        setState(prev => ({ ...prev, reserve: [...prev.reserve, customPlayer.name] }));
    };

    const performMove = useCallback((src, dst) => {
        if (src.posId === dst.posId && src.slotIdx === dst.slotIdx) return;

        setState(prev => {
            const next = { ...prev, depthChart: { ...prev.depthChart }, reserve: [...prev.reserve], cuts: [...prev.cuts] };
            const dc = next.depthChart;

            // Capture displaced player for swap
            const displaced = (dst.posId !== '__ir__' && dst.posId !== '__cut__')
                ? (dc[dst.posId]?.[dst.slotIdx] ?? null)
                : null;

            // Remove from source
            if (src.posId === '__ir__') next.reserve.splice(src.slotIdx, 1);
            else if (src.posId === '__cut__') next.cuts.splice(src.slotIdx, 1);
            else {
                if (!dc[src.posId]) dc[src.posId] = [];
                dc[src.posId] = [...dc[src.posId]];
                dc[src.posId][src.slotIdx] = null;
            }

            // Place at destination
            if (dst.posId === '__ir__') next.reserve.push(src.slot.name);
            else if (dst.posId === '__cut__') next.cuts.push(src.slot.name);
            else {
                if (!dc[dst.posId]) dc[dst.posId] = [];
                dc[dst.posId] = [...dc[dst.posId]];
                dc[dst.posId][dst.slotIdx] = makeSlot(src.slot.name, dst.targetZone);
            }

            // Swap displaced back to source
            if (displaced) {
                if (src.posId === '__ir__') next.reserve.push(displaced.name);
                else if (src.posId === '__cut__') next.cuts.push(displaced.name);
                else dc[src.posId][src.slotIdx] = makeSlot(displaced.name, src.slot?.zone ?? '53');
            }

            return next;
        });
    }, [setState]);

    const handleAddPosition = (label) => {
        if (!label || !addPositionPhase) return;
        const phase = addPositionPhase;
        const id = `${phase[0].toUpperCase()}-${label}-${Date.now()}`;
        setState(prev => ({
            ...prev,
            positionConfig: { ...prev.positionConfig, [phase]: [...prev.positionConfig[phase], { id, label, slots53: 2 }] }
        }));
        setAddPositionPhase(null);
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

    // Deleting a row used to only drop it from positionConfig — anyone still
    // in its depthChart slots became orphaned (not rendered anywhere, but
    // not actually removed from state either — just silently gone from the
    // UI). Move any occupants to Cuts instead, matching how IR/Cuts already
    // work as a never-truly-lose-a-player safety net rather than a hard delete.
    const handleDeletePosition = (phase, posId) => {
        setState(prev => {
            const occupants = (prev.depthChart[posId] ?? []).filter(Boolean).map(s => s.name);
            const nextDepthChart = { ...prev.depthChart };
            delete nextDepthChart[posId];
            return {
                ...prev,
                depthChart: nextDepthChart,
                cuts: [...prev.cuts, ...occupants],
                positionConfig: {
                    ...prev.positionConfig,
                    [phase]: prev.positionConfig[phase].filter(x => x.id !== posId),
                },
            };
        });
    };

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

    const handleBootstrap = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        setState(parseCSV(text));
        setBootstrapping(false);
    };

    const handleFetchAdapter = async () => {
        try {
            setBootstrapping(true);
            setState(await fetchAdapterRoster());
            setBootstrapping(false);
        } catch (err) {
            alert('Failed to fetch: ' + err.message);
            setBootstrapping(false);
        }
    };

    const handleFetchLocal = async () => {
        try {
            setBootstrapping(true);
            setState(await fetchLocalRoster());
            setBootstrapping(false);
        } catch (err) {
            alert('Failed to load: ' + err.message);
            setBootstrapping(false);
        }
    };

    const handleExport = () => {
        const csv = exportCSV(state);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'roster.csv';
        a.click();
    };

    // Explicit, anytime-runnable, additive-only: pulls FA's candidates,
    // the user's own real draft picks, and UDFA signings into empty 53-man
    // slots. Never overwrites an occupied slot or removes anything — safe
    // to run repeatedly as new picks/signings/candidates accumulate without
    // losing hand-edits made in Roster between runs. Never writes to FA's
    // own state (read-only via faState.loadState()).
    const handleSyncFromStages = () => {
        const fa = faState.loadState();
        const ourPicks = (draftedPlayers || []).filter(p => p.draftedByUs && (p.pickNumber || 0) <= 257);
        const udfaSignings = (draftedPlayers || []).filter(p => (p.pickNumber || 0) > 257);

        setState(prev => {
            const next = { ...prev, depthChart: { ...prev.depthChart } };
            const dc = next.depthChart;
            const allChips = [...prev.positionConfig.offense, ...prev.positionConfig.defense];

            const placeInFirstEmpty53 = (name, declaredPos) => {
                if (!name || !declaredPos) return;
                const rowId = resolvePosition(declaredPos, prev.positionConfig, dc);
                if (!rowId) return; // no matching row — leave for manual placement, don't guess a new one
                const chip = allChips.find(p => p.id === rowId);
                const limit53 = chip?.slots53 ?? 2;
                const arr = dc[rowId] = [...(dc[rowId] ?? [])];
                for (let i = 0; i < limit53; i++) {
                    if (!arr[i]) { arr[i] = makeSlot(name, '53'); return; }
                }
                // Row's 53-man slots are all full — don't overflow into PS/reserve
                // implicitly, don't overwrite; this player is simply skipped this run.
            };

            if (fa?.depthChart) {
                const faChips = [...(fa.positionConfig?.offense ?? []), ...(fa.positionConfig?.defense ?? [])];
                Object.entries(fa.depthChart).forEach(([faRowId, slots]) => {
                    const label = faChips.find(p => p.id === faRowId)?.label ?? faRowId;
                    (slots || []).forEach(s => { if (s) placeInFirstEmpty53(s.name, label); });
                });
            }
            ourPicks.forEach(p => placeInFirstEmpty53(p.name, p.position));
            udfaSignings.forEach(p => placeInFirstEmpty53(p.name, p.position));

            return next;
        });
    };

    const handlePasteHtml = () => {
        if (!pastedHtml.trim()) return;
        try {
            setState(parseHTMLToRoster(pastedHtml));
            setBootstrapping(false);
            setIsPasting(false);
        } catch (err) { alert('Failed: ' + err.message); }
    };

    if (bootstrapping && !state.positionConfig.offense.length) {
        return (
            <div className="roster-bootstrap">
                <div className="roster-bootstrap-title">INITIALIZE ROSTER</div>

                {!isPasting ? (
                    <div className="roster-bootstrap-actions">
                        {hasRosterSourceAdapter() && (
                            <button onClick={handleFetchAdapter} className="roster-btn primary">Auto-Fetch Depth Chart</button>
                        )}
                        <button onClick={handleFetchLocal} className="roster-btn">Load Default Roster</button>
                        <button onClick={() => setIsPasting(true)} className="roster-btn">Paste HTML source</button>
                        <label className="roster-btn" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                            Upload CSV
                            <input type="file" accept=".csv" onChange={handleBootstrap} style={{ display: 'none' }} />
                        </label>
                    </div>
                ) : (
                    <div className="roster-paste-box">
                        <textarea
                            className="roster-paste-textarea"
                            placeholder="Paste Ourlads source (Ctrl+U from the site)..."
                            value={pastedHtml}
                            onChange={e => setPastedHtml(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 15 }}>
                            <button onClick={handlePasteHtml} className="roster-btn primary" style={{ flex: 1 }}>Process HTML</button>
                            <button onClick={() => setIsPasting(false)} className="roster-btn" style={{ flex: 1 }}>Cancel</button>
                        </div>
                    </div>
                )}
                <div className="roster-bootstrap-hint">
                    Automate your roster setup by fetching the latest depth chart directly,<br />or use your manual baseline files.
                </div>
            </div>
        );
    }

    const { positionConfig, depthChart, reserve, cuts } = state;
    let oCount = 0, dCount = 0, psCount = 0, total = 0;

    // "REMAINING NEEDS" itself is computed and rendered inside DepthChartGrid
    // now (it needs the same per-position slot counts this loop derives) —
    // this copy is only for the toolbar's 53-man/PS/Total counters above.
    const calculateStats = (positions) => {
        positions.forEach(p => {
            const slots = depthChart[p.id] ?? [];
            const s53 = Math.max(p.slots53, 1);
            slots.forEach((s, i) => {
                if (s) {
                    total++;
                    if (i < s53) { if (positions === positionConfig.offense) oCount++; else dCount++; }
                    else if (i < s53 + 3) psCount++;
                }
            });
        });
    };
    calculateStats(positionConfig.offense);
    calculateStats(positionConfig.defense);

    let destined53 = oCount + dCount;
    SPECIALIST_IDS.forEach(id => {
        const s = depthChart[id]?.[0];
        if (s) { destined53++; total++; }
    });
    total += reserve.length;

    const counterStatus = (val, max) => {
        if (val === max) return 'status-ok';
        if (val < max) return 'status-under';
        return 'status-over';
    };

    return (
        <div className="roster-view">
            {/* Toolbar — visually matches the Draft view's top-panel */}
            <div className="top-panel">
                <div className="roster-brand">
                    <span className="roster-brand-name">CHIEFS</span>
                    <span className="roster-brand-sub">DEPTH CHART</span>
                </div>

                <div style={{ flex: 1 }} />

                <div className="roster-counters">
                    <CounterBox label="53-MAN" val={destined53} max={53} status={counterStatus(destined53, 53)} />
                    <CounterBox label="PRACTICE SQUAD" val={psCount} max={16} status={counterStatus(psCount, 16)} />
                    <CounterBox label="TOTAL SQUAD" val={total} max={91} status={counterStatus(total, 91)} isLast maxLabel="90+1" />
                </div>

                <div className="top-actions">
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
                    <button onClick={handleSyncFromStages} className="action-pill" title="Fill empty slots from FA candidates, draft picks, and UDFA signings — never overwrites">Sync from FA/Draft/UDFA</button>
                    <button onClick={handleExport} className="action-pill">Export CSV</button>
                    <button onClick={() => setShowResetConfirm(true)} className="action-pill reset-pill">Reset</button>
                </div>
            </div>

            <DepthChartGrid
                positionConfig={positionConfig}
                depthChart={depthChart}
                reserve={reserve}
                cuts={cuts}
                masterPlayers={masterPlayers}
                draftedPlayers={draftedPlayers}
                onMove={performMove}
                onRowMove={performRowMove}
                onDeletePosition={handleDeletePosition}
                onSlotsChange={handleSlotsChange}
                onAddPosition={setAddPositionPhase}
                onSignClick={() => setIsSignModalOpen(true)}
                zoomLevel={zoomLevel}
            />

            <UnrankedModal key={`sign-${isSignModalOpen}`} isOpen={isSignModalOpen} onClose={() => setIsSignModalOpen(false)} onDraft={handleSignPlayer} mode={isDraftComplete ? 'postdraft' : 'roster'} />

            {addPositionPhase && (
                <TextPromptDialog
                    title={`Add ${addPositionPhase === 'offense' ? 'Offense' : 'Defense'} Position`}
                    placeholder="Position label (e.g. WR.Z)"
                    onSubmit={handleAddPosition}
                    onCancel={() => setAddPositionPhase(null)}
                />
            )}

            {showResetConfirm && (
                <ConfirmDialog
                    title="Reset Roster?"
                    message="This clears your entire depth chart, practice squad, injury reserve, and cut list. This cannot be undone."
                    onConfirm={() => { setState(defaultState()); setBootstrapping(true); setShowResetConfirm(false); }}
                    onCancel={() => setShowResetConfirm(false)}
                />
            )}
        </div>
    );
}
