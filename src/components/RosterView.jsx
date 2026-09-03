import React, { useState, useCallback } from 'react';
import {
    DndContext, DragOverlay, useDraggable, useDroppable,
    useSensor, useSensors, MouseSensor, TouchSensor
} from '@dnd-kit/core';
import {
    loadState, saveState, defaultState,
    parseCSV, exportCSV, makeSlot,
    SPECIALIST_IDS, POS_TRANSLATIONS, fetchOurladsRoster, fetchLocalRoster, parseHTMLToRoster
} from '../utils/rosterState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';
import { parseName } from '../utils/formatName';
import UnrankedModal from './UnrankedModal';

const PS_SLOTS = 3;

// ── Helper: Pick to Round ──────────────────────────────────────────────
function getRoundFromPick(pick) {
    const p = parseInt(pick);
    if (isNaN(p)) return null;
    if (p <= 32) return 1;
    if (p <= 64) return 2;
    if (p <= 100) return 3;
    if (p <= 135) return 4;
    if (p <= 175) return 5;
    if (p <= 210) return 6;
    return 7;
}

function zoneClass(zone, isNeed) {
    if (zone) return `zone-${zone}`;
    return isNeed ? 'zone-need' : '';
}

// slotMeta runs once per rendered slot — dozens of times per render — and
// each call name-matches against the full masterPlayers/draftedPlayers
// lists. Caching each list's name index by reference (safe: both come from
// useDraftState, which always replaces rather than mutates these arrays)
// turns that from a per-cell rebuild into a one-time-per-render-pass cost.
const nameIndexCache = new WeakMap();
function getOrBuildIndex(list) {
    if (!list) return [];
    let idx = nameIndexCache.get(list);
    if (!idx) {
        idx = buildNameIndex(list);
        nameIndexCache.set(list, idx);
    }
    return idx;
}

function slotMeta(slot, masterPlayers, draftedPlayers) {
    const { displayName, suffix, nameColor } = parseName(slot?.name);

    const findByRobustName = (list) => {
        if (!list) return null;
        const idx = findMatchingIndex(displayName, getOrBuildIndex(list));
        return idx !== -1 ? list[idx] : null;
    };
    const draftData = findByRobustName(draftedPlayers) || findByRobustName(masterPlayers);

    let topLabel = suffix || '';
    if (draftData && (draftData.round || draftData.pickNumber)) {
        const r = draftData.round || getRoundFromPick(draftData.pickNumber);
        const p = draftData.pickNumber;
        if (r && p && !isNaN(parseInt(p))) topLabel = `R${r}: ${p}`;
        else if (r) topLabel = `R${r}`;
        else if (p) topLabel = !isNaN(parseInt(p)) ? `PICK ${p}` : p;
    } else if (suffix && /^\d+$/.test(suffix)) {
        topLabel = `R${suffix}`;
    }

    const rawPos = draftData?.position || '';
    const displayPos = POS_TRANSLATIONS[rawPos] || rawPos;

    return { displayName, nameColor, topLabel, displayPos };
}

// ── Shared card content (also reused by the DragOverlay clone) ────────────
function SlotCardContent({ displayName, nameColor, topLabel, displayPos, small, className }) {
    return (
        <div className={className ?? 'rv-slot-content'}>
            <span
                className="rv-slot-name"
                style={small ? { color: nameColor, fontSize: '0.85rem', fontWeight: 800 } : { color: nameColor }}
            >
                {displayName}
            </span>
            <div className="rv-slot-meta">
                <span className="rv-slot-tag">{topLabel}</span>
                <span className="rv-slot-pos">{displayPos}</span>
            </div>
        </div>
    );
}

// ── Slot cell ─────────────────────────────────────────────────────────────
// Draggable (when filled) and droppable (always) share the same logical id
// but separate dnd-kit registries (useDraggable/useDroppable each track
// their own id namespace), so reusing `posId::slotIdx` for both is safe.
function SlotCell({ slot, zone, posId, slotIdx, targetZone, onClick, masterPlayers, draftedPlayers }) {
    const isNeed = !slot && zone === '53';
    const meta = slotMeta(slot, masterPlayers, draftedPlayers);
    const resolvedZone = targetZone ?? zone;
    const cellId = `${posId}::${slotIdx}`;

    const { setNodeRef: setDropRef, isOver } = useDroppable({
        id: `drop-${cellId}`,
        data: { kind: 'item', posId, slotIdx, targetZone: resolvedZone },
    });
    const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
        id: `drag-${cellId}`,
        disabled: !slot,
        data: { kind: 'item', posId, slotIdx, slot },
    });

    return (
        <div
            ref={node => { setDropRef(node); setDragRef(node); }}
            {...(slot ? listeners : {})}
            {...(slot ? attributes : {})}
            onClick={() => slot && onClick && onClick(slot, posId, slotIdx)}
            className={`rv-slot ${slot ? 'filled' : ''} ${zoneClass(slot?.zone ?? zone, isNeed)} ${isOver ? 'drag-over' : ''} ${isDragging ? 'dragging-source' : ''}`}
            style={slot ? { cursor: 'grab' } : undefined}
        >
            {slot ? (
                <SlotCardContent {...meta} />
            ) : isNeed ? (
                <span className="rv-slot-need-label">NEED</span>
            ) : null}
        </div>
    );
}

// ── Single row — 4 grid cells: [pos+ctrl | 53-man | PS | Reserve] ────────────
// The row-header cell is a drop target for reordering, but only its position
// label is a drag handle — keeping the delete/±count buttons outside the
// drag listeners avoids any pointerdown conflict between "click a button"
// and "start dragging the row".
function DepthRow({ posConfig, slots, idx, phase, onConfigChange, onDeletePosition, masterPlayers, draftedPlayers }) {
    const { id, label, slots53 } = posConfig;
    const rowParity = idx % 2 === 0 ? 'odd' : '';
    const rowId = `${phase}::${idx}`;

    const { setNodeRef: setDropRef, isOver } = useDroppable({
        id: `drop-row-${rowId}`,
        data: { kind: 'row', idx, phase },
    });
    const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
        id: `drag-row-${rowId}`,
        data: { kind: 'row', idx, phase, label },
    });

    // Build slot arrays for each zone
    const s53 = Math.max(slots53, 1);
    const slots53Items = Array.from({ length: s53 }, (_, i) => ({ slot: slots[i] || null, zone: '53', idx: i }));
    // Always show one empty drop target at the end of each section
    const psStart = s53;
    const psItems = [];
    for (let i = 0; i < PS_SLOTS; i++) { if (slots[psStart + i]) psItems.push({ slot: slots[psStart + i], zone: 'ps', idx: psStart + i }); }
    psItems.push({ slot: null, zone: 'ps', idx: psStart + psItems.length });

    const rStart = s53 + PS_SLOTS;
    const rItems = [];
    for (let i = 0; slots[rStart + i]; i++) rItems.push({ slot: slots[rStart + i], zone: 'r', idx: rStart + i });
    rItems.push({ slot: null, zone: 'r', idx: rStart + rItems.length });

    return (
        <React.Fragment>
            {/* Col 1: Pos label + - N + controller */}
            <div
                ref={setDropRef}
                className={`rv-row-cell rv-pos-cell ${rowParity} ${isOver ? 'drag-over' : ''}`}
            >
                <button
                    className="rv-delete-pos"
                    title={`Remove ${label}`}
                    onClick={e => { e.stopPropagation(); onDeletePosition(); }}
                >✕</button>
                <div
                    ref={setDragRef}
                    {...listeners}
                    {...attributes}
                    className={`rv-pos-label ${isDragging ? 'dragging-source' : ''}`}
                    style={{ cursor: 'grab' }}
                >
                    {label}
                </div>
                <div className="rv-pos-ctrl">
                    <button onClick={e => { e.stopPropagation(); onConfigChange(Math.max(0, slots53 - 1)); }} className="rv-ctrl-btn">-</button>
                    <span className="rv-pos-count">{slots53}</span>
                    <button onClick={e => { e.stopPropagation(); onConfigChange(Math.min(6, slots53 + 1)); }} className="rv-ctrl-btn">+</button>
                </div>
            </div>

            {/* Col 2: 53-Man */}
            <div className={`rv-row-cell ${rowParity}`}>
                {slots53Items.map(item => (
                    <SlotCell key={item.idx} slot={item.slot} zone={item.zone} posId={id} slotIdx={item.idx} targetZone="53" masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                ))}
            </div>

            {/* Col 3: Practice Squad */}
            <div className={`rv-row-cell ${rowParity}`}>
                {psItems.map(item => (
                    <SlotCell key={item.idx} slot={item.slot} zone={item.zone} posId={id} slotIdx={item.idx} targetZone="ps" masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                ))}
            </div>

            {/* Col 4: Reserve */}
            <div className={`rv-row-cell last ${rowParity}`}>
                {rItems.map(item => (
                    <SlotCell key={item.idx} slot={item.slot} zone={item.zone} posId={id} slotIdx={item.idx} targetZone="r" masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                ))}
            </div>
        </React.Fragment>
    );
}

// ── Specialist cell ────────────────────────────────────────────────────────
// No explicit targetZone here (matches prior behavior): makeSlot()'s default
// zone param ('53') is what a moved player lands with, since specialists
// aren't tracked as a distinct zone.
function SpecialistCell({ id, slot, masterPlayers, draftedPlayers }) {
    const label = { P: 'Punter', K: 'Kicker', LS: 'Long Snapper' }[id] ?? id;
    const meta = slotMeta(slot, masterPlayers, draftedPlayers);

    const { setNodeRef: setDropRef, isOver } = useDroppable({
        id: `drop-spec-${id}`,
        data: { kind: 'item', posId: id, slotIdx: 0, targetZone: undefined },
    });
    const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
        id: `drag-spec-${id}`,
        disabled: !slot,
        data: { kind: 'item', posId: id, slotIdx: 0, slot },
    });

    return (
        <div
            ref={setDropRef}
            className={`rv-specialist ${slot ? 'filled' : ''} ${isOver ? 'drag-over' : ''}`}
        >
            <div className="rv-specialist-label">{label}</div>
            {slot ? (
                <div
                    ref={setDragRef}
                    {...listeners}
                    {...attributes}
                    className={`rv-slot-content ${isDragging ? 'dragging-source' : ''}`}
                    style={{ cursor: 'grab' }}
                >
                    <span className="rv-slot-name" style={{ color: meta.nameColor, fontSize: '0.85rem', fontWeight: 800 }}>{meta.displayName}</span>
                    <div className="rv-slot-meta">
                        <span className="rv-slot-tag">{meta.topLabel}</span>
                        <span className="rv-slot-pos">{meta.displayPos}</span>
                    </div>
                </div>
            ) : (
                <div className="rv-specialist-need">NEED</div>
            )}
        </div>
    );
}

// ── Roster Side Panel ── Cut panel only (IR is at bottom of main content)
function RosterSidebar({ cuts, onSign, masterPlayers, draftedPlayers }) {
    const { setNodeRef, isOver } = useDroppable({
        id: 'drop-cut-zone',
        data: { kind: 'item', posId: '__cut__', slotIdx: cuts.length, targetZone: 'cut' },
    });
    return (
        <div className="roster-sidebar">
            <button onClick={onSign} className="action-pill roster-sign-btn">+ SIGN PLAYER</button>

            <div ref={setNodeRef} className={`roster-cuts ${isOver ? 'drag-over' : ''}`}>
                <div className="roster-cuts-label">CUT PANEL — {cuts.length}</div>
                <div className="roster-cuts-list">
                    {cuts.map((name, i) => (
                        <SlotCell
                            key={i} slot={{ name, zone: 'cut' }} zone="cut" posId="__cut__" slotIdx={i} targetZone="cut"
                            masterPlayers={masterPlayers} draftedPlayers={draftedPlayers}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

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

// ── Main RosterView ────────────────────────────────────────────────────────
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

    const updateOffenseConfig = (cfg) => setState(prev => ({ ...prev, positionConfig: { ...prev.positionConfig, offense: cfg } }));
    const updateDefenseConfig = (cfg) => setState(prev => ({ ...prev, positionConfig: { ...prev.positionConfig, defense: cfg } }));

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

    // ── Drag-and-drop (mouse + touch, via @dnd-kit) ──────────────────────────
    // MouseSensor uses a small movement threshold so plain clicks don't start
    // a drag. TouchSensor uses a hold delay instead: a quick swipe (scrolling)
    // is released back to the browser as a normal scroll, and only a
    // deliberate press-and-hold locks into a drag — this is what actually
    // stops touch drags from hijacking scroll gestures.
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    );
    const [activeDragData, setActiveDragData] = useState(null);

    const handleDragStart = useCallback(({ active }) => {
        setActiveDragData(active.data.current ?? null);
    }, []);

    const handleDragEnd = useCallback(({ active, over }) => {
        setActiveDragData(null);
        if (!over) return;
        const src = active.data.current;
        const dst = over.data.current;
        if (!src || !dst || src.kind !== dst.kind) return;

        if (src.kind === 'row') {
            performRowMove(src.idx, src.phase, dst.idx, dst.phase);
        } else {
            performMove(src, dst);
        }
    }, [performMove, performRowMove]);

    const handleDragCancel = useCallback(() => setActiveDragData(null), []);

    const handleBootstrap = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        setState(parseCSV(text));
        setBootstrapping(false);
    };

    const handleFetchOurlads = async () => {
        try {
            setBootstrapping(true);
            setState(await fetchOurladsRoster());
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
                        <button onClick={handleFetchOurlads} className="roster-btn primary">Auto-Fetch Depth Chart</button>
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
    let oCount = 0, dCount = 0, psCount = 0, total = 0, needs = 0;

    const calculateStats = (positions) => {
        positions.forEach(p => {
            const slots = depthChart[p.id] ?? [];
            const s53 = Math.max(p.slots53, 1);
            slots.forEach((s, i) => {
                if (s) {
                    total++;
                    if (i < s53) { if (positions === positionConfig.offense) oCount++; else dCount++; }
                    else if (i < s53 + 3) psCount++;
                } else if (i < s53) needs++;
            });
            for (let i = slots.length; i < s53; i++) needs++;
        });
    };
    calculateStats(positionConfig.offense);
    calculateStats(positionConfig.defense);

    let destined53 = oCount + dCount;
    SPECIALIST_IDS.forEach(id => {
        const s = depthChart[id]?.[0];
        if (s) { destined53++; total++; } else needs++;
    });
    total += reserve.length;

    const counterStatus = (val, max) => {
        if (val === max) return 'status-ok';
        if (val < max) return 'status-under';
        return 'status-over';
    };

    return (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
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
                    <button onClick={handleExport} className="action-pill">Export CSV</button>
                    <button onClick={() => setShowResetConfirm(true)} className="action-pill reset-pill">Reset</button>
                </div>
            </div>

            <div className="roster-body">
                <div className="roster-main">
                    <div className="roster-section-header">
                        <div className="roster-section-title">OFFENSE</div>
                        <div className="roster-section-count">{oCount}</div>
                        <button onClick={() => setAddPositionPhase('offense')} className="action-pill">+ Add Position</button>
                    </div>
                    <div className="roster-grid">
                        <DepthHeader />
                        {positionConfig.offense.map((p, idx) => (
                            <DepthRow key={p.id} idx={idx} phase="offense" posConfig={p} slots={depthChart[p.id] ?? []} onConfigChange={val => handleSlotsChange(p.id, val)} onDeletePosition={() => updateOffenseConfig(positionConfig.offense.filter(x => x.id !== p.id))} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                        ))}
                    </div>

                    <div className="roster-section-header" style={{ marginTop: 60 }}>
                        <div className="roster-section-title">DEFENSE</div>
                        <div className="roster-section-count">{dCount}</div>
                        <button onClick={() => setAddPositionPhase('defense')} className="action-pill">+ Add Position</button>
                    </div>
                    <div className="roster-grid">
                        <DepthHeader />
                        {positionConfig.defense.map((p, idx) => (
                            <DepthRow key={p.id} idx={idx} phase="defense" posConfig={p} slots={depthChart[p.id] ?? []} onConfigChange={val => handleSlotsChange(p.id, val)} onDeletePosition={() => updateDefenseConfig(positionConfig.defense.filter(x => x.id !== p.id))} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                        ))}
                    </div>

                    <div className="roster-specialists">
                        <div style={{ display: 'flex', gap: 12 }}>
                            {SPECIALIST_IDS.map(id => (
                                <SpecialistCell key={id} id={id} slot={depthChart[id]?.[0] ?? null} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                            ))}
                        </div>
                        <div style={{ flex: 1 }} />
                        {needs > 0 && <div className="roster-needs-label">REMAINING NEEDS: {needs}</div>}
                    </div>

                    {/* IR — bottom */}
                    <IRDropZone reserve={reserve} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                </div>

                <RosterSidebar cuts={cuts} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} onSign={() => setIsSignModalOpen(true)} />
            </div>

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

        <DragOverlay dropAnimation={null}>
            {activeDragData?.kind === 'item' && activeDragData.slot ? (
                <div className="rv-slot filled rv-drag-overlay">
                    <SlotCardContent {...slotMeta(activeDragData.slot, masterPlayers, draftedPlayers)} />
                </div>
            ) : activeDragData?.kind === 'row' ? (
                <div className="rv-pos-label rv-drag-overlay">{activeDragData.label}</div>
            ) : null}
        </DragOverlay>
        </DndContext>
    );
}

function IRDropZone({ reserve, masterPlayers, draftedPlayers }) {
    const { setNodeRef, isOver } = useDroppable({
        id: 'drop-ir-zone',
        data: { kind: 'item', posId: '__ir__', slotIdx: reserve.length, targetZone: 'ir' },
    });
    return (
        <div ref={setNodeRef} className={`roster-ir ${isOver ? 'drag-over' : ''}`}>
            <div className="roster-ir-label">INJURY RESERVE — {reserve.length}</div>
            <div className="roster-ir-list">
                {reserve.map((name, i) => (
                    <SlotCell key={i} slot={{ name, zone: 'ir' }} zone="ir" posId="__ir__" slotIdx={i} targetZone="ir" masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                ))}
            </div>
        </div>
    );
}

// DepthHeader — 4 cells matching the row grid
function DepthHeader() {
    return (
        <React.Fragment>
            <div className="rv-h">Pos</div>
            <div className="rv-h" style={{ textAlign: 'left', paddingLeft: 10 }}>53-Man</div>
            <div className="rv-h" style={{ textAlign: 'left', paddingLeft: 10 }}>Practice Squad</div>
            <div className="rv-h" style={{ textAlign: 'left', paddingLeft: 10 }}>Reserve</div>
        </React.Fragment>
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
