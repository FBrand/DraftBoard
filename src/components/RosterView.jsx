import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    loadState, saveState, defaultState,
    parseCSV, exportCSV, makeSlot, resolvePosition,
    SPECIALIST_IDS, POS_TRANSLATIONS, fetchOurladsRoster
} from '../utils/rosterState';
import { findMatchingPlayerIndex } from '../utils/nameMatcher';
import UnrankedModal from './UnrankedModal';

// ── Zone colour tokens ────────────────────────────────────────────────────
const ZONE_STYLE = {
    '53': { color: 'var(--text-main)', border: '1px solid rgba(255,183,0,0.6)', bg: 'var(--panel-bg)' },
    ps: { color: 'var(--text-main)', border: '1px solid rgba(59,130,246,0.6)', bg: 'var(--panel-bg)' },
    ir: { color: 'var(--text-main)', border: '1px solid rgba(239,68,68,0.5)', bg: 'var(--panel-bg)' },
    r: { color: 'var(--text-main)', border: '1px solid rgba(171, 171, 171, 0.5)', bg: 'var(--panel-bg)' },
    cut: { color: 'var(--text-dim)', border: '1px solid rgba(255,255,255,0.1)', bg: 'rgba(0,0,0,0.2)' },
    need: { border: '1px dashed rgba(255,183,0,0.8)', bg: 'rgba(255,183,0,0.03)' },
    empty: { border: '1px dashed rgba(255,255,255,0.1)', bg: 'transparent' },
};

// ── Helper: Pick to Round ──────────────────────────────────────────────
function getRoundFromPick(pick) {
    const p = parseInt(pick);
    if (isNaN(p)) return null;
    // Standard NFL draft round estimation
    if (p <= 32) return 1;
    if (p <= 64) return 2;
    if (p <= 100) return 3;
    if (p <= 135) return 4;
    if (p <= 175) return 5;
    if (p <= 210) return 6;
    return 7;
}

// ── Helper: Parse name suffixes ──────────────────────────────────────────
function parseName(rawName, defaultColor = 'var(--text-main)') {
    if (!rawName) return { displayName: '', suffix: '', nameColor: defaultColor };
    const parts = rawName.split(':');
    const displayName = parts[0].trim();
    const suffix = parts[1]?.trim() || '';

    let nameColor = defaultColor;
    if (suffix) {
        if (/^\d+$/.test(suffix)) nameColor = '#FFD700'; // Gold (Draft Pick)
        else if (suffix === 'UDFA') nameColor = 'rgba(255, 215, 0, 0.6)'; // Dim Gold
        else if (suffix === 'FA') nameColor = '#3b82f6'; // Blue (Free Agent)
    }
    return { displayName, suffix, nameColor };
}

// ── Slot cell ─────────────────────────────────────────────────────────────
function SlotCell({ slot, zone, posId, slotIdx, targetZone, onDragStart, onDrop, onDragOver, onClick, masterPlayers, draftedPlayers }) {
    const isNeed = !slot && zone === '53';
    const zStyle = slot ? ZONE_STYLE[slot.zone ?? zone] : (isNeed ? ZONE_STYLE.need : ZONE_STYLE.empty);
    const { displayName, suffix, nameColor } = parseName(slot?.name, zStyle.color);

    // Draft info lookup: prioritize draftedPlayers, then masterPlayers
    const findByRobustName = (list) => {
        if (!list) return null;
        const idx = findMatchingPlayerIndex(displayName, list);
        return idx !== -1 ? list[idx] : null;
    };
    const draftData = findByRobustName(draftedPlayers) || findByRobustName(masterPlayers);

    let topLabel = suffix || '';
    if (draftData && (draftData.round || draftData.pickNumber)) {
        // High priority: use full draft details from draftedPlayers/masterPlayers
        const r = draftData.round || getRoundFromPick(draftData.pickNumber);
        const p = draftData.pickNumber;
        if (r && p) topLabel = `R${r}: ${p}`;
        else if (r) topLabel = `R${r}`;
        else if (p) topLabel = `PICK ${p}`;
    } else if (suffix && /^\d+$/.test(suffix)) {
        // Fallback: treat CSV numeric suffix as Round
        topLabel = `R${suffix}`;
    }

    const rawPos = draftData?.position || '';
    const displayPos = POS_TRANSLATIONS[rawPos] || rawPos;

    return (
        <div
            draggable={!!slot}
            onDragStart={e => slot && onDragStart(e, { posId, slotIdx, slot })}
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => onDrop(e, { posId, slotIdx, targetZone: targetZone ?? zone })}
            onClick={() => slot && onClick && onClick(slot, posId, slotIdx)}
            style={{
                width: 170,
                height: 40,
                borderRadius: 8,
                border: zStyle.border,
                background: zStyle.bg,
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                cursor: slot ? 'grab' : 'default',
                userSelect: 'none',
                flexShrink: 0,
                transition: 'all .15s ease',
                boxShadow: slot ? '0 2px 4px rgba(0,0,0,0.2)' : 'none',
            }}
        >
            {slot ? (
                <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 6, overflow: 'hidden' }}>
                    <span style={{ flex: 1, fontSize: '0.78rem', fontWeight: 600, color: nameColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayName}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', width: 65, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 6, textAlign: 'left' }}>
                        <span style={{ fontSize: '0.52rem', color: '#ff0000', fontWeight: 800, textTransform: 'uppercase', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                            {topLabel}
                        </span>
                        <span style={{ fontSize: '0.52rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.1 }}>
                            {displayPos}
                        </span>
                    </div>
                </div>
            ) : isNeed ? (
                <span style={{ fontSize: '0.65rem', color: 'rgba(255,183,0,0.5)', fontStyle: 'italic' }}>NEED</span>
            ) : null}
        </div>
    );
}

// ── Single row in depth chart ────────────────────────────────────────────────
function DepthRow({ posConfig, slots, onDragStart, onDrop, onDragOver, idx, phase, onConfigChange, onDeletePosition, onRowDragStart, onRowDrop, masterPlayers, draftedPlayers }) {
    const { id, label, slots53 } = posConfig;

    // Helper to get slice and ensure at least 1 empty if needed
    const getSectionItems = (startIdx, length, zoneLabel) => {
        const items = [];
        let foundAny = false;
        for (let i = 0; i < length; i++) {
            const actualIdx = startIdx + i;
            if (slots[actualIdx]) {
                items.push({ slot: slots[actualIdx], zone: zoneLabel, idx: actualIdx });
                foundAny = true;
            } else if (!foundAny && i === 0) {
                // Keep at least the first cell if it's the start of the section
                items.push({ slot: null, zone: zoneLabel, idx: actualIdx });
            }
        }
        // Always add one empty cell at the end of the existing players in this section
        // but only if we don't already have one
        if (foundAny) {
            const nextIdx = startIdx + items.length;
            items.push({ slot: null, zone: zoneLabel, idx: nextIdx });
        }
        return items;
    };

    const s53Count = Math.max(slots53, 1);
    // 53-Man: ALWAYS show exactly s53Count slots
    const slots53Items = Array.from({ length: s53Count }, (_, i) => ({
        slot: slots[i] || null,
        zone: '53',
        idx: i
    }));

    // PS: standard limit is 3, but dynamic: show players + 1
    const psItems = getSectionItems(s53Count, 3, 'ps');

    // Reserve: show players + 1 (up to index 20 or so)
    const rItems = getSectionItems(s53Count + 3, 10, 'r');

    return (
        <>
            {/* Position ID / Drag Handle */}
            <div
                draggable
                onDragStart={e => onRowDragStart(e, idx, phase)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => onRowDrop(e, idx, phase)}
                style={{ cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--chiefs-gold)', fontFamily: "'Outfit', sans-serif" }}>{label}</div>
            </div>

            {/* Config: Number of 53-man slots */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid rgba(255,255,255,0.05)', paddingRight: 10 }}>
                <input
                    type="number"
                    min="0"
                    max="5"
                    value={slots53}
                    onChange={e => onConfigChange(parseInt(e.target.value) || 0)}
                    style={{ width: 35, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.75rem', textAlign: 'center', borderRadius: 4 }}
                />
            </div>

            {/* 53-Man Slots */}
            <div style={{ display: 'flex', gap: 4, padding: '4px 12px 4px 0', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                {slots53Items.map(({ slot, zone, idx }) => (
                    <SlotCell
                        key={idx} slot={slot} zone={zone} posId={id} slotIdx={idx} targetZone="53"
                        onDragStart={onDragStart} onDrop={onDrop} onDragOver={onDragOver}
                        masterPlayers={masterPlayers} draftedPlayers={draftedPlayers}
                    />
                ))}
            </div>

            {/* Practice Squad */}
            <div style={{ display: 'flex', gap: 4, padding: '4px 12px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                {psItems.map(({ slot, zone, idx }) => (
                    <SlotCell
                        key={idx} slot={slot} zone={zone} posId={id} slotIdx={idx} targetZone="ps"
                        onDragStart={onDragStart} onDrop={onDrop} onDragOver={onDragOver}
                        masterPlayers={masterPlayers} draftedPlayers={draftedPlayers}
                    />
                ))}
            </div>

            {/* Extended Roster */}
            <div style={{ display: 'flex', gap: 4, padding: '4px 12px' }}>
                {rItems.map(({ slot, zone, idx }) => (
                    <SlotCell
                        key={idx} slot={slot} zone={zone} posId={id} slotIdx={idx} targetZone="r"
                        onDragStart={onDragStart} onDrop={onDrop} onDragOver={onDragOver}
                        masterPlayers={masterPlayers} draftedPlayers={draftedPlayers}
                    />
                ))}
            </div>
        </>
    );
}

// ── Roster Side Panel ──────────────────────────────────────────────────
function RosterSidebar({ cuts, onDrop, onDragStart, onSign, masterPlayers, draftedPlayers }) {
    return (
        <div style={{ width: 220, borderLeft: '2px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.2)', flexShrink: 0 }}>
            <button
                onClick={onSign}
                className="action-pill"
                style={{ margin: 12, background: 'var(--chiefs-gold)', color: '#000', fontWeight: 800, borderRadius: 8 }}
            >+ SIGN PLAYER</button>

            <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => onDrop(e, { posId: '__cut__', slotIdx: -1, targetZone: 'cut' })}
                style={{ flex: 1, padding: '0 12px', overflowY: 'auto' }}
            >
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4, fontFamily: "'Outfit', sans-serif" }}>
                    Cut Panel — {cuts.length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {cuts.map((name, i) => (
                        <SlotCell
                            key={i} slot={{ name, zone: 'cut' }} zone="cut" posId="__cut__" slotIdx={i} targetZone="cut"
                            onDragStart={onDragStart} onDrop={onDrop}
                            masterPlayers={masterPlayers} draftedPlayers={draftedPlayers}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── Specialist cell ────────────────────────────────────────────────────────
function SpecialistCell({ id, slot, onDragStart, onDrop, masterPlayers, draftedPlayers }) {
    const label = { P: 'Punter', K: 'Kicker', LS: 'Long Snapper' }[id] ?? id;
    const zStyle = slot ? ZONE_STYLE['53'] : ZONE_STYLE.need;

    return (
        <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => onDrop(e, { posId: id, slotIdx: 0 })}
            style={{
                width: 170, padding: '8px 12px', borderRadius: 8,
                border: zStyle.border,
                background: zStyle.bg,
                display: 'flex', flexDirection: 'column', gap: 4,
                boxShadow: slot ? '0 2px 4px rgba(0,0,0,0.2)' : 'none',
                transition: 'all 0.15s ease'
            }}
        >
            <div style={{ fontSize: '0.65rem', color: 'var(--chiefs-gold)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'Outfit', sans-serif" }}>{label}</div>
            {slot ? (() => {
                const { displayName, suffix, nameColor } = parseName(slot.name);
                // Draft info lookup: prioritize draftedPlayers, then masterPlayers
                const findByRobustName = (list) => {
                    if (!list) return null;
                    const idx = findMatchingPlayerIndex(displayName, list);
                    return idx !== -1 ? list[idx] : null;
                };
                const draftData = findByRobustName(draftedPlayers) || findByRobustName(masterPlayers);

                let topLabel = suffix || '';
                if (draftData && (draftData.round || draftData.pickNumber)) {
                    // High priority: use full draft details
                    const r = draftData.round || getRoundFromPick(draftData.pickNumber);
                    const p = draftData.pickNumber;
                    if (r && p) topLabel = `R${r}: ${p}`;
                    else if (r) topLabel = `R${r}`;
                    else if (p) topLabel = `PICK ${p}`;
                } else if (suffix && /^\d+$/.test(suffix)) {
                    // Fallback: treat CSV numeric suffix as Round
                    topLabel = `R${suffix}`;
                }
                const rawPos = draftData?.position || '';
                const displayPos = POS_TRANSLATIONS[rawPos] || rawPos;

                return (
                    <div
                        draggable
                        onDragStart={e => onDragStart(e, { posId: id, slotIdx: 0, slot })}
                        style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 6, overflow: 'hidden' }}
                    >
                        <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 700, color: nameColor, cursor: 'grab', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', width: 65, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 6, textAlign: 'left' }}>
                            <span style={{ fontSize: '0.52rem', color: '#ff0000', fontWeight: 800, textTransform: 'uppercase', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{topLabel}</span>
                            <span style={{ fontSize: '0.52rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayPos}</span>
                        </div>
                    </div>
                );
            })() : (
                <div style={{ fontSize: '0.7rem', color: 'rgba(255,183,0,0.4)', fontStyle: 'italic', fontWeight: 600 }}>NEED</div>
            )}
        </div>
    );
}

// ── Main RosterView ────────────────────────────────────────────────────────
export default function RosterView({ masterPlayers, draftedPlayers, currentPick, onDraft }) {
    const [state, setStateRaw] = useState(() => {
        const loaded = loadState() ?? defaultState();
        if (!loaded.cuts) loaded.cuts = [];
        if (!loaded.reserve) loaded.reserve = [];
        return loaded;
    });
    const [bootstrapping, setBootstrapping] = useState(() => loadState() === null);
    const [isSignModalOpen, setIsSignModalOpen] = useState(false);

    const isDraftComplete = (currentPick || 1) > 257;

    // ALL hooks must be declared before any early return
    const setState = useCallback(next => {
        setStateRaw(prev => {
            const result = typeof next === 'function' ? next(prev) : next;
            saveState(result);
            return result;
        });
    }, []);

    const handleSignPlayer = (customPlayer) => {
        // 1. Add to draft board state
        if (onDraft) onDraft(customPlayer);

        // 2. Add to roster state (reserve pool)
        setState(prev => ({ ...prev, reserve: [...prev.reserve, customPlayer.name] }));
    };

    const handleDrop = useCallback((e, dst) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('application/json');
        if (!raw) return;
        const src = JSON.parse(raw);

        // Same slot? ignore
        if (src.posId === dst.posId && src.slotIdx === dst.slotIdx) return;

        setState(prev => {
            const next = { ...prev, depthChart: { ...prev.depthChart }, reserve: [...prev.reserve], cuts: [...prev.cuts] };
            const dc = next.depthChart;

            // Remove from source
            if (src.posId === '__ir__') {
                next.reserve.splice(src.slotIdx, 1);
            } else if (src.posId === '__cut__') {
                next.cuts.splice(src.slotIdx, 1);
            } else {
                dc[src.posId][src.slotIdx] = null;
                // Trim trailing nulls
                while (dc[src.posId].length && dc[src.posId][dc[src.posId].length - 1] === null)
                    dc[src.posId].pop();
            }

            // Insert at destination
            if (dst.posId === '__ir__') {
                next.reserve.push(src.slot.name);
            } else if (dst.posId === '__cut__') {
                next.cuts.push(src.slot.name);
            } else {
                if (!dc[dst.posId]) dc[dst.posId] = [];
                const targetIdx = dst.slotIdx === -1 ? dc[dst.posId].length : dst.slotIdx;
                dc[dst.posId][targetIdx] = makeSlot(src.slot.name, dst.targetZone);
            }

            return next;
        });
    }, [setState]);

    const handleDragStart = (e, data) => {
        e.dataTransfer.setData('application/json', JSON.stringify(data));
    };

    const handleAddPosition = (phase) => {
        const label = prompt('Position label (e.g. WR, DE):');
        if (!label) return;
        const id = `${phase[0].toUpperCase()}-${label}-${Date.now()}`;
        setState(prev => ({
            ...prev,
            positionConfig: {
                ...prev.positionConfig,
                [phase]: [...prev.positionConfig[phase], { id, label, slots53: 2 }]
            }
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

    const updateOffenseConfig = (cfg) => setState(prev => ({ ...prev, positionConfig: { ...prev.positionConfig, offense: cfg } }));
    const updateDefenseConfig = (cfg) => setState(prev => ({ ...prev, positionConfig: { ...prev.positionConfig, defense: cfg } }));

    const handleRowDragStart = (e, idx, phase) => {
        e.dataTransfer.setData('rowIdx', idx);
        e.dataTransfer.setData('rowPhase', phase);
    };

    const handleRowDrop = (e, dstIdx, dstPhase) => {
        const srcIdx = parseInt(e.dataTransfer.getData('rowIdx'));
        const srcPhase = e.dataTransfer.getData('rowPhase');
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
    };

    const handleBootstrap = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const newState = parseCSV(text);
        setState(newState);
        setBootstrapping(false);
    };

    const handleFetchOurlads = async () => {
        try {
            setBootstrapping(true);
            // const newState = await fetchOurladsRoster();
            const newState = await fetch(`${import.meta.env.BASE_URL}roster.csv`).then(r => r.text()).then(parseCSV);
            setState(newState);
            setBootstrapping(false);
        } catch (err) {
            alert('Failed to fetch roster: ' + err.message);
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

    if (bootstrapping && !state.positionConfig.offense.length) {
        return (
            <div style={{ background: 'var(--bg-color)', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20 }}>
                <div style={{ color: 'var(--chiefs-gold)', fontSize: '1.5rem', fontWeight: 900, fontFamily: "'Outfit', sans-serif" }}>INITIALIZE ROSTER</div>

                <div style={{ display: 'flex', gap: 12 }}>
                    <button onClick={handleFetchOurlads} style={{ ...btnStyle, background: 'var(--chiefs-gold)', color: '#000', padding: '12px 24px', fontSize: '0.9rem' }}>
                        Auto-Fetch Depth Chart
                    </button>

                    <label style={{ ...btnStyle, padding: '12px 24px', fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                        Upload CSV
                        <input type="file" accept=".csv" onChange={handleBootstrap} style={{ display: 'none' }} />
                    </label>
                </div>

                <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', textAlign: 'center', maxWidth: 400, lineHeight: 1.5 }}>
                    Quick-start by fetching the latest Chiefs depth chart directly,<br />or upload your custom <code>roster.csv</code>.
                </div>
            </div>
        );
    }

    // ── Counters ───────────────────────────────────────────────────────────
    const { positionConfig, depthChart, reserve, cuts } = state;

    let destined53 = 0, psCount = 0, total = 0, needs = 0;
    let oCount = 0, dCount = 0;

    positionConfig.offense.forEach(p => {
        const slots = depthChart[p.id] ?? [];
        const s53 = Math.max(p.slots53, 1);
        slots.forEach((s, i) => {
            if (s) {
                total++;
                if (i < s53) oCount++;
                else if (i < s53 + 3) psCount++; // 3 is PS_DISPLAY_COUNT
            } else if (i < s53) {
                needs++;
            }
        });
        for (let i = slots.length; i < s53; i++) needs++;
    });
    positionConfig.defense.forEach(p => {
        const slots = depthChart[p.id] ?? [];
        const s53 = Math.max(p.slots53, 1);
        slots.forEach((s, i) => {
            if (s) {
                total++;
                if (i < s53) dCount++;
                else if (i < s53 + 3) psCount++; // 3 is PS_DISPLAY_COUNT
            } else if (i < s53) {
                needs++;
            }
        });
        for (let i = slots.length; i < s53; i++) needs++;
    });
    destined53 = oCount + dCount;
    SPECIALIST_IDS.forEach(id => {
        const s = depthChart[id]?.[0];
        if (s) { destined53++; total++; }
        else needs++;
    });
    // Add reserve (Extended Roster) to Total, but not to 53/PS.
    total += reserve.length;

    const getCounterColor = (val, max) => {
        if (val === max) return '#4ade80'; // Green
        if (val < max) return '#fbbf24'; // Yellow
        return 'var(--chiefs-red)'; // Red
    };

    return (
        <div style={{ background: 'var(--bg-color)', height: '100%', display: 'flex', flexDirection: 'column', color: 'var(--text-main)', fontFamily: 'Inter, sans-serif', overflow: 'hidden' }}>
            {/* Toolbar */}
            <div className='top-panel' style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0 24px',
                height: 80,
                background: 'rgba(0,0,0,0.4)',
                borderBottom: '2px solid var(--chiefs-gold)',
                gap: 24,
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900, letterSpacing: '0.05em', color: '#fff', fontFamily: "'Outfit', sans-serif" }}>ROSTER MANAGEMENT</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--chiefs-gold)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.2em' }}>Chiefs Kingdom</div>
                </div>

                <div style={{ flex: 1 }} />

                <div style={{ display: 'flex', gap: 32 }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontWeight: 800, textTransform: 'uppercase' }}>53-Man</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 900, color: getCounterColor(destined53, 53) }}>{destined53} <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>/ 53</span></div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontWeight: 800, textTransform: 'uppercase' }}>Practice Squad</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 900, color: getCounterColor(psCount, 16) }}>{psCount} <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>/ 16</span></div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontWeight: 800, textTransform: 'uppercase' }}>Total</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 900, color: getCounterColor(total, 91) }}>{total} <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>/ 90+1</span></div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 10, marginLeft: 20 }}>
                    <button onClick={handleExport} style={btnStyle}>Export CSV</button>
                    <button onClick={() => { if (confirm('Reset all depth chart changes?')) { setState(defaultState()); setBootstrapping(true); } }} style={{ ...btnStyle, color: 'var(--chiefs-red)' }}>Reset</button>
                </div>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <div style={{ flex: 1, padding: '0 16px 24px', overflowY: 'auto', minHeight: 0, minWidth: 0 }}>
                    {/* OFFENSE */}
                    <SectionHeader label="OFFENSE" count={oCount} onAdd={() => handleAddPosition('offense')} />
                    <div style={{ display: 'grid', gridTemplateColumns: '70px 60px max-content max-content max-content', alignItems: 'stretch' }}>
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '4px 0' }}>Pos</div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '4px 0' }}>Slots</div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', paddingLeft: 12, borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '4px 0' }}>53-Man Roster</div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', paddingLeft: 12, borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '4px 0' }}>Practice Squad</div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', paddingLeft: 12, borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '4px 0' }}>Reserve</div>

                        {positionConfig.offense.map((p, idx) => (
                            <DepthRow
                                key={p.id}
                                idx={idx}
                                phase="offense"
                                posConfig={p}
                                slots={depthChart[p.id] ?? []}
                                onDragStart={handleDragStart}
                                onDrop={handleDrop}
                                onConfigChange={val => handleSlotsChange(p.id, val)}
                                onDeletePosition={() => updateOffenseConfig(positionConfig.offense.filter(x => x.id !== p.id))}
                                onRowDragStart={handleRowDragStart}
                                onRowDrop={handleRowDrop}
                                masterPlayers={masterPlayers}
                                draftedPlayers={draftedPlayers}
                            />
                        ))}
                    </div>

                    {/* DEFENSE */}
                    <SectionHeader label="DEFENSE" count={dCount} onAdd={() => handleAddPosition('defense')} style={{ marginTop: 40 }} />
                    <div style={{ display: 'grid', gridTemplateColumns: '70px 60px max-content max-content max-content', alignItems: 'stretch' }}>
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '4px 0' }}>Pos</div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '4px 0' }}>Slots</div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', paddingLeft: 12, borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '4px 0' }}>53-Man Roster</div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', paddingLeft: 12, borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '4px 0' }}>Practice Squad</div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', paddingLeft: 12, borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '4px 0' }}>Reserve</div>

                        {positionConfig.defense.map((p, idx) => (
                            <DepthRow
                                key={p.id}
                                idx={idx}
                                phase="defense"
                                posConfig={p}
                                slots={depthChart[p.id] ?? []}
                                onDragStart={handleDragStart}
                                onDrop={handleDrop}
                                onConfigChange={val => handleSlotsChange(p.id, val)}
                                onDeletePosition={() => updateDefenseConfig(positionConfig.defense.filter(x => x.id !== p.id))}
                                onRowDragStart={handleRowDragStart}
                                onRowDrop={handleRowDrop}
                                masterPlayers={masterPlayers}
                                draftedPlayers={draftedPlayers}
                            />
                        ))}
                    </div>

                    {/* SPECIALISTS + COUNTERS */}
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 16, flexWrap: 'wrap', borderTop: '2px solid var(--chiefs-red)', paddingTop: 12 }}>
                        <div style={{ display: 'flex', gap: 10 }}>
                            {SPECIALIST_IDS.map(id => (
                                <SpecialistCell
                                    key={id} id={id}
                                    slot={depthChart[id]?.[0] ?? null}
                                    onDragStart={handleDragStart}
                                    onDrop={handleDrop}
                                    masterPlayers={masterPlayers}
                                    draftedPlayers={draftedPlayers}
                                />
                            ))}
                        </div>
                        <div style={{ flex: 1 }} />
                        <div style={{ textAlign: 'right', lineHeight: 1.7 }}>
                            {needs > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--chiefs-gold)', fontWeight: 800, fontFamily: "'Outfit', sans-serif" }}>NEEDS: {needs}</div>}
                        </div>
                    </div>

                    {/* INJURED SECTION */}
                    <div
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => handleDrop(e, { posId: '__ir__', slotIdx: -1, targetZone: 'ir' })}
                        style={{ padding: '8px 0', borderTop: '2px solid rgba(255,255,255,0.08)', marginTop: 12 }}
                    >
                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--chiefs-red)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: "'Outfit', sans-serif" }}>
                            Injured — {reserve.length}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {reserve.map((name, i) => (
                                <SlotCell
                                    key={i} slot={{ name, zone: 'ir' }} zone="ir" posId="__ir__" slotIdx={i} targetZone="ir"
                                    onDragStart={handleDragStart} onDrop={handleDrop}
                                    masterPlayers={masterPlayers} draftedPlayers={draftedPlayers}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                <RosterSidebar
                    cuts={cuts}
                    onDragStart={handleDragStart}
                    onDrop={handleDrop}
                    masterPlayers={masterPlayers}
                    draftedPlayers={draftedPlayers}
                    onSign={() => setIsSignModalOpen(true)}
                />
            </div>

            <UnrankedModal
                isOpen={isSignModalOpen}
                onClose={() => setIsSignModalOpen(false)}
                onDraft={handleSignPlayer}
                isUDFAVersion={isDraftComplete}
            />
        </div>
    );
}

function SectionHeader({ label, count, onAdd, style }) {
    return (
        <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            padding: '12px 0 8px',
            borderBottom: '2px solid var(--chiefs-red)',
            marginBottom: 12,
            fontFamily: "'Outfit', sans-serif",
            ...style
        }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, letterSpacing: '0.1em', color: '#fff', textTransform: 'uppercase' }}>
                {label}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--chiefs-gold)', opacity: 1, marginRight: 16 }}>{count}</div>
            {onAdd && (
                <button
                    onClick={onAdd}
                    className="action-pill"
                    style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                >+ Add Position</button>
            )}
        </div>
    );
}

const btnStyle = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6,
    color: 'var(--text-main)',
    cursor: 'pointer',
    padding: '4px 12px',
    fontSize: '0.78rem',
    fontWeight: 600,
};
