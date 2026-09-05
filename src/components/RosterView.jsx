import React, { useState, useCallback, useEffect } from 'react';
import {
    loadState, saveState, defaultState,
    parseCSV, exportCSV, makeSlot, resolvePosition,
    SPECIALIST_IDS, hasRosterSourceAdapter, fetchAdapterRoster, fetchLocalRoster, fetchSeasonStartStructure, parseHTMLToRoster
} from '../utils/rosterState';
import * as faState from '../utils/faState';
import UnrankedModal from './UnrankedModal';
import DepthChartGrid from './DepthChartGrid';
import { TextPromptDialog, ConfirmDialog } from './Dialogs';
import Toast from './Toast';
import Menu from './Menu';
import { shouldSeed } from '../utils/appInit';
import { isDraftComplete, isDraftPick, isUndraftedSigning } from '../utils/draftPhase';
import { resolve as resolvePlayer, setFacts } from '../utils/playerRegistry';
import useUndoableState from '../hooks/useUndoableState';

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
export default function RosterView({ masterPlayers, draftedPlayers, currentPick, onInfoOpen }) {
    const draftIsComplete = isDraftComplete(currentPick);
    // Roster initialises like every other phase — silently, with no screen of
    // its own to get past. Seeded mode loads the real post-offseason roster;
    // clean mode loads last season's position structure with the slots empty,
    // so there is a depth chart to build into and "Sync from FA/Draft/UDFA"
    // has somewhere to place players. The import options that used to live on
    // the blocking bootstrap screen are in this view's menu instead.
    const [seeding, setSeeding] = useState(() => loadState() === null);
    const [isSignModalOpen, setIsSignModalOpen] = useState(false);
    const [isPasting, setIsPasting] = useState(false);
    const [pastedHtml, setPastedHtml] = useState('');
    const [addPositionPhase, setAddPositionPhase] = useState(null); // 'offense' | 'defense' | null
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [toast, setToast] = useState(null); // { message, tone }
    // Stable identity: Toast's auto-dismiss timer keys off this, so an inline
    // arrow would restart the countdown on every render.
    const dismissToast = useCallback(() => setToast(null), []);
    // The depth-chart grid is desktop-wide by design (many position columns);
    // on a phone that means horizontal scrolling to reach most slots. `zoom`
    // (not transform:scale, which wouldn't shrink the actual scrollable
    // layout) lets a mobile user shrink the whole grid to fit more on screen.
    const [zoomLevel, setZoomLevel] = useState(1);

    // Slots are normalised on the way in, so the value that lands in state,
    // in history and in storage is always the same shape — an un-normalised
    // snapshot would come back subtly different when undone.
    const normalizeState = useCallback(result => {
        if (!result?.depthChart || !result?.positionConfig) return result;

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
        [...(result.positionConfig.offense || []), ...(result.positionConfig.defense || [])]
            .forEach(p => {
                if (newDC[p.id]) newDC[p.id] = normalize(newDC[p.id], Math.max(1, p.slots53));
            });
        return { ...result, depthChart: newDC };
    }, []);

    const [state, setUndoableState, history] = useUndoableState(() => {
        const loaded = loadState() ?? defaultState();
        if (!loaded.cuts) loaded.cuts = [];
        if (!loaded.reserve) loaded.reserve = [];
        return loaded;
    }, saveState);

    const setState = useCallback(next => {
        setUndoableState(prev => normalizeState(typeof next === 'function' ? next(prev) : next));
    }, [setUndoableState, normalizeState]);

    // One-shot: only runs when there is nothing saved and we're in seeded mode.
    // Any later edit writes state, so this never fires again and can't overwrite
    // real work. A failure drops through to the bootstrap screen rather than
    // leaving the view stuck on a spinner.
    useEffect(() => {
        if (!seeding) return;
        let cancelled = false;
        (async () => {
            try {
                const loaded = shouldSeed()
                    ? await fetchLocalRoster()
                    : await fetchSeasonStartStructure();
                if (cancelled) return;
                history.reset(loaded);
            } catch (err) {
                if (cancelled) return;
                // An empty grid plus the menu's import options is still a
                // usable view, so report and carry on.
                setToast({ message: `Couldn't load the roster: ${err.message}`, tone: 'error' });
            } finally {
                if (!cancelled) setSeeding(false);
            }
        })();
        return () => { cancelled = true; };
        // history.reset is stable (useCallback in useUndoableState); listing
        // the whole object would re-run this on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seeding]);

    // Signing is a roster move, not a draft pick.
    //
    // This used to call draftPlayer, which stamps the *current* pick number on
    // the player and advances the draft — so signing a free agent after nine
    // picks recorded him as pick ten. It also pushed the name onto `reserve`,
    // which is the injury-reserve pool, so every signing arrived injured.
    //
    // A signing now lands in the player's own position row: first free 53-man
    // slot, then practice squad, then that row's reserve column. Nothing
    // touches draft state; the arrival tag beside the name records how they
    // arrived, the same thing roster.csv encodes in its suffix.
    const handleSignPlayer = (customPlayer) => {
        const { name, position, arrival = null, team, previousTeam } = customPlayer;
        const displayName = String(name).split(':')[0];

        // Team and previous team are facts about the player, so they go on his
        // record. How he arrived HERE is a fact about this roster, so it stays
        // on the slot.
        if (team || previousTeam) {
            const id = resolvePlayer({ name: displayName, position });
            if (id) setFacts(id, { ...(team ? { team } : {}), ...(previousTeam ? { previousTeam } : {}) });
        }

        // Computed outside setState: an updater is deferred to the render
        // phase, so a result read back straight after it would be stale.
        const next = { ...state, depthChart: { ...state.depthChart } };
        const rowId = resolvePosition(position, state.positionConfig, next.depthChart);

        if (!rowId) {
            setToast({
                message: `No ${position} row on the depth chart — add one, then sign ${displayName}.`,
                tone: 'error',
            });
            return;
        }

        const chip = [...state.positionConfig.offense, ...state.positionConfig.defense]
            .find(p => p.id === rowId);
        const limit53 = Math.max(1, chip?.slots53 ?? 2);
        const arr = next.depthChart[rowId] = [...(next.depthChart[rowId] ?? [])];

        const placeAt = (index, zone, label) => {
            arr[index] = makeSlot(displayName, zone, arrival);
            setState(next);
            setToast({ message: `Signed ${displayName} — ${chip?.label ?? position}, ${label}.`, tone: 'success' });
        };

        for (let i = 0; i < limit53; i++) {
            if (!arr[i]) return placeAt(i, '53', '53-man');
        }
        for (let i = limit53; i < limit53 + 3; i++) {
            if (!arr[i]) return placeAt(i, 'ps', 'practice squad');
        }
        let i = limit53 + 3;
        while (arr[i]) i++;
        return placeAt(i, 'r', 'reserve');
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
                dc[dst.posId][dst.slotIdx] = makeSlot(src.slot.name, dst.targetZone, src.slot.arrival ?? null);
            }

            // Swap displaced back to source
            if (displaced) {
                if (src.posId === '__ir__') next.reserve.push(displaced.name);
                else if (src.posId === '__cut__') next.cuts.push(displaced.name);
                else dc[src.posId][src.slotIdx] = makeSlot(displaced.name, src.slot?.zone ?? '53', displaced.arrival ?? null);
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
        history.reset(parseCSV(text));
    };

    const handleFetchAdapter = async () => {
        try {
            history.reset(await fetchAdapterRoster());
        } catch (err) {
            setToast({ message: 'Failed to fetch roster: ' + err.message, tone: 'error' });
        }
    };

    const handleFetchLocal = async () => {
        try {
            history.reset(await fetchLocalRoster());
        } catch (err) {
            setToast({ message: 'Failed to load default roster: ' + err.message, tone: 'error' });
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
        const ourPicks = (draftedPlayers || []).filter(p => p.draftedByUs && isDraftPick(p));
        const udfaSignings = (draftedPlayers || []).filter(isUndraftedSigning);

        // Computed from `state` directly and applied as a plain value, NOT
        // inside a setState updater: the updater is deferred to the render
        // phase (and may run more than once), so counters mutated in there
        // can't be read back here to build the summary — an earlier version
        // did exactly that and reported stale/doubled numbers.
        let placed = 0, noRow = 0, rowFull = 0, alreadyPresent = 0;

        const next = { ...state, depthChart: { ...state.depthChart } };
        const dc = next.depthChart;
        const allChips = [...state.positionConfig.offense, ...state.positionConfig.defense];

        const isAlreadyOnRoster = (name) =>
            Object.values(dc).some(slots => (slots ?? []).some(s => s?.name === name)) ||
            (next.reserve ?? []).includes(name) ||
            (next.cuts ?? []).includes(name);

        const placeInFirstEmpty53 = (name, declaredPos) => {
            if (!name || !declaredPos) return;
            if (isAlreadyOnRoster(name)) { alreadyPresent++; return; }
            const rowId = resolvePosition(declaredPos, state.positionConfig, dc);
            if (!rowId) { noRow++; return; } // no matching row — leave for manual placement, don't guess a new one
            const chip = allChips.find(p => p.id === rowId);
            const limit53 = chip?.slots53 ?? 2;
            const arr = dc[rowId] = [...(dc[rowId] ?? [])];
            for (let i = 0; i < limit53; i++) {
                if (!arr[i]) { arr[i] = makeSlot(name, '53'); placed++; return; }
            }
            // Row's 53-man slots are all full — don't overflow into PS/reserve
            // implicitly, don't overwrite; this player is simply skipped this run.
            rowFull++;
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

        if (placed > 0) setState(next);

        const skips = [
            noRow && `${noRow} had no matching position row`,
            rowFull && `${rowFull} had no free 53-man slot`,
            alreadyPresent && `${alreadyPresent} already on the roster`,
        ].filter(Boolean);

        setToast(placed > 0
            ? {
                message: `Placed ${placed} player${placed === 1 ? '' : 's'}` + (skips.length ? ` — skipped: ${skips.join(', ')}.` : '.'),
                tone: 'success',
            }
            : {
                message: skips.length
                    ? `Nothing placed — ${skips.join(', ')}.`
                    : 'Nothing to sync — no FA candidates, draft picks, or UDFA signings found.',
                tone: 'info',
            });
    };

    const handlePasteHtml = () => {
        if (!pastedHtml.trim()) return;
        try {
            history.reset(parseHTMLToRoster(pastedHtml));
            setIsPasting(false);
        } catch (err) { setToast({ message: 'Could not parse pasted roster: ' + err.message, tone: 'error' }); }
    };

    // The paste-source flow is a modal now rather than a whole-screen mode,
    // so the depth chart stays visible behind it.
    const pasteDialog = isPasting && (
        <div className="modal-overlay" onClick={() => setIsPasting(false)}>
            <div className="modal-content roster-paste-box" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Paste depth chart source</h2>
                    <button className="close-btn" onClick={() => setIsPasting(false)}>&times;</button>
                </div>
                <textarea
                    className="roster-paste-textarea"
                    placeholder="Paste the page source (Ctrl+U on the depth chart page)..."
                    value={pastedHtml}
                    onChange={e => setPastedHtml(e.target.value)}
                />
                <div className="modal-footer">
                    <button onClick={() => setIsPasting(false)} className="cancel-pill">Cancel</button>
                    <button onClick={handlePasteHtml} className="save-pill" disabled={!pastedHtml.trim()}>Process</button>
                </div>
            </div>
        </div>
    );

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
                    <button
                        onClick={history.undo}
                        disabled={!history.canUndo}
                        className="action-pill undo-pill"
                        title="Undo the last change"
                    >Undo</button>
                    <button onClick={handleSyncFromStages} className="action-pill" title="Fill empty slots from FA candidates, draft picks, and UDFA signings — never overwrites">Sync from FA/Draft/UDFA</button>
                    <Menu items={[
                        // The load/import options that used to be a blocking
                        // "initialize roster" screen.
                        hasRosterSourceAdapter() && { label: 'Auto-Fetch Depth Chart', onClick: handleFetchAdapter },
                        { label: 'Load Default Roster', onClick: handleFetchLocal, title: 'The shipped post-offseason roster' },
                        { label: 'Paste Depth Chart Source…', onClick: () => setIsPasting(true) },
                        { label: 'Import Roster CSV…', file: { accept: '.csv', onFile: handleBootstrap } },
                        { label: 'Export Roster CSV…', onClick: handleExport },
                        { label: 'Clear Roster…', onClick: () => setShowResetConfirm(true), tone: 'danger' },
                    ]} />
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
                onInfoOpen={onInfoOpen}
            />

            <UnrankedModal key={`sign-${isSignModalOpen}`} isOpen={isSignModalOpen} onClose={() => setIsSignModalOpen(false)} onDraft={handleSignPlayer} mode={draftIsComplete ? 'postdraft' : 'roster'} />

            {addPositionPhase && (
                <TextPromptDialog
                    title={`Add ${addPositionPhase === 'offense' ? 'Offense' : 'Defense'} Position`}
                    placeholder="Position label (e.g. WR.Z)"
                    onSubmit={handleAddPosition}
                    onCancel={() => setAddPositionPhase(null)}
                />
            )}

            {pasteDialog}

            {showResetConfirm && (
                <ConfirmDialog
                    title="Clear the roster?"
                    message="Empties every slot, the practice squad, injury reserve and the cut list, leaving the position rows in place to rebuild into."
                    confirmLabel="Clear it"
                    onConfirm={() => {
                        // Keep the position rows: an empty depth chart with no
                        // rows has nowhere for Sync — or you — to put anyone.
                        history.reset({
                            ...state,
                            depthChart: Object.fromEntries(Object.keys(state.depthChart).map(id => [id, []])),
                            reserve: [],
                            cuts: [],
                        });
                        setShowResetConfirm(false);
                    }}
                    onCancel={() => setShowResetConfirm(false)}
                />
            )}

            <Toast message={toast?.message} tone={toast?.tone} onDismiss={dismissToast} />
        </div>
    );
}
