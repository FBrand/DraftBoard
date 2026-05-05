import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    loadState, saveState, defaultState,
    parseCSV, exportCSV, makeSlot, resolvePosition,
    SPECIALIST_IDS, POS_TRANSLATIONS, fetchOurladsRoster, fetchLocalRoster, parseHTMLToRoster
} from '../utils/rosterState';
import { findMatchingPlayerIndex } from '../utils/nameMatcher';
import UnrankedModal from './UnrankedModal';

// ── Zone colour tokens ────────────────────────────────────────────────────
const ZONE_STYLE = {
    '53': { color: 'var(--text-main)', border: '1px solid rgba(255,183,0,0.7)', bg: 'rgba(30,30,30,0.8)' },
    ps: { color: 'var(--text-main)', border: '1px solid rgba(59,130,246,0.7)', bg: 'rgba(30,30,30,0.6)' },
    ir: { color: 'var(--text-main)', border: '1px solid rgba(239,68,68,0.6)', bg: 'rgba(30,30,30,0.6)' },
    r: { color: 'var(--text-main)', border: '1px solid rgba(171, 171, 171, 0.4)', bg: 'rgba(30,30,30,0.4)' },
    cut: { color: 'var(--text-dim)', border: '1px solid rgba(255,255,255,0.1)', bg: 'rgba(0,0,0,0.4)' },
    need: { border: '1px dashed rgba(255,183,0,0.5)', bg: 'rgba(255,183,0,0.05)' },
    empty: { border: '1px dashed rgba(255,255,255,0.1)', bg: 'transparent' },
};

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

// ── Helper: Parse name suffixes ──────────────────────────────────────────
function parseName(rawName, defaultColor = 'var(--text-main)') {
    if (!rawName) return { displayName: '', suffix: '', nameColor: defaultColor };
    const parts = rawName.split(':');
    const displayName = parts[0].trim();
    const suffix = parts[1]?.trim() || '';

    let nameColor = defaultColor;
    if (suffix) {
        if (/^\d+$/.test(suffix)) nameColor = '#FFD700'; // Gold (Draft Pick)
        else if (suffix === 'UDFA') nameColor = 'rgba(255, 215, 0, 0.8)'; // Bright Gold
        else if (suffix === 'FA') nameColor = '#60a5fa'; // Brighter Blue
        else if (suffix === 'IR') nameColor = 'var(--chiefs-red)'; // Red
        else if (suffix === 'RP') nameColor = '#FFD700'; // Rookie Pick
    }
    return { displayName, suffix, nameColor };
}

const MAX_DISPLAY_SLOTS = 12;

// ── Slot cell ─────────────────────────────────────────────────────────────
function SlotCell({ slot, zone, posId, slotIdx, targetZone, onDragStart, onDrop, onDragOver, onClick, masterPlayers, draftedPlayers }) {
    const isNeed = !slot && zone === '53';
    const zStyle = slot ? ZONE_STYLE[slot.zone ?? zone] : (isNeed ? ZONE_STYLE.need : ZONE_STYLE.empty);
    const { displayName, suffix, nameColor } = parseName(slot?.name, zStyle.color);

    const findByRobustName = (list) => {
        if (!list) return null;
        const idx = findMatchingPlayerIndex(displayName, list);
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

    return (
        <div
            draggable={!!slot}
            onDragStart={e => slot && onDragStart(e, { posId, slotIdx, slot })}
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => onDrop(e, { posId, slotIdx, targetZone: targetZone ?? zone })}
            onClick={() => slot && onClick && onClick(slot, posId, slotIdx)}
            style={{
                width: 175,
                height: 42,
                borderRadius: 8,
                border: zStyle.border,
                background: slot ? `linear-gradient(135deg, ${zStyle.bg}, rgba(255,255,255,0.05))` : zStyle.bg,
                display: 'flex',
                alignItems: 'center',
                padding: '0 10px',
                cursor: slot ? 'grab' : 'default',
                userSelect: 'none',
                flexShrink: 0,
                transition: 'all .2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: slot ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
                backdropFilter: 'blur(4px)',
                position: 'relative',
                zIndex: slot ? 2 : 1,
            }}
        >
            {slot ? (
                <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 6, overflow: 'hidden' }}>
                    <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 700, color: nameColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.01em' }}>
                        {displayName}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.15)', paddingLeft: 4, textAlign: 'right', gap: 5 }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--chiefs-red)', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                            {topLabel}
                        </span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.1 }}>
                            {displayPos}
                        </span>
                    </div>
                </div>
            ) : isNeed ? (
                <span style={{ fontSize: '0.7rem', color: 'rgba(255,183,0,0.4)', fontStyle: 'italic', fontWeight: 800, letterSpacing: '0.1em' }}>NEED</span>
            ) : null}
        </div>
    );
}

// ── Single row in depth chart ────────────────────────────────────────────────
function DepthRow({ posConfig, slots, onDragStart, onDrop, onDragOver, idx, phase, onConfigChange, onDeletePosition, onRowDragStart, onRowDrop, masterPlayers, draftedPlayers }) {
    const { id, label, slots53 } = posConfig;

    // We build a flat list of slot indices for the master grid.
    // slots53 defines the 53-man zone.
    // PS is fixed at 3 slots after 53-man.
    // Reserve is everything after that.
    
    return (
        <div style={{ 
            display: 'grid', 
            gridTemplateColumns: `70px 60px repeat(${MAX_DISPLAY_SLOTS}, 175px)`, 
            alignItems: 'center', 
            background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', 
            borderRadius: 6,
            position: 'relative',
            zIndex: 100 - idx,
            gap: 6,
        }}>
            {/* Pos Label */}
            <div
                draggable
                onDragStart={e => onRowDragStart(e, idx, phase)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => onRowDrop(e, idx, phase)}
                style={{ cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 50 }}
            >
                <div style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--chiefs-gold)', fontFamily: "'Outfit', sans-serif" }}>{label}</div>
            </div>

            {/* Slots Config */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: 10 }}>
                <input
                    type="number"
                    min="0"
                    max="5"
                    value={slots53}
                    onChange={e => onConfigChange(parseInt(e.target.value) || 0)}
                    style={{ width: 38, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.8rem', fontWeight: 700, textAlign: 'center', borderRadius: 4 }}
                />
            </div>

            {/* Individual Slots (Unified Grid) */}
            {Array.from({ length: MAX_DISPLAY_SLOTS }, (_, i) => {
                let zone = '53';
                if (i >= slots53 + 3) zone = 'r';
                else if (i >= slots53) zone = 'ps';

                return (
                    <SlotCell
                        key={i}
                        slot={slots[i] || null}
                        zone={zone}
                        posId={id}
                        slotIdx={i}
                        targetZone={zone}
                        onDragStart={onDragStart}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        masterPlayers={masterPlayers}
                        draftedPlayers={draftedPlayers}
                    />
                );
            })}
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
                width: 175, padding: '10px 15px', borderRadius: 10,
                border: zStyle.border,
                background: zStyle.bg,
                display: 'flex', flexDirection: 'column', gap: 6,
                boxShadow: slot ? '0 4px 15px rgba(0,0,0,0.4)' : 'none',
                transition: 'all 0.2s ease',
                backdropFilter: 'blur(8px)',
                position: 'relative',
                zIndex: 2,
            }}
        >
            <div style={{ fontSize: '0.7rem', color: 'var(--chiefs-gold)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', fontFamily: "'Outfit', sans-serif" }}>{label}</div>
            {slot ? (() => {
                const { displayName, suffix, nameColor } = parseName(slot.name);
                const findByRobustName = (list) => {
                    if (!list) return null;
                    const idx = findMatchingPlayerIndex(displayName, list);
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

                return (
                    <div
                        draggable
                        onDragStart={e => onDragStart(e, { posId: id, slotIdx: 0, slot })}
                        style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 6, overflow: 'hidden' }}
                    >
                        <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 800, color: nameColor, cursor: 'grab', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: 4, textAlign: 'right', gap: 5 }}>
                            <span style={{ fontSize: '0.65rem', color: 'var(--chiefs-red)', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{topLabel}</span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayPos}</span>
                        </div>
                    </div>
                );
            })() : (
                <div style={{ fontSize: '0.75rem', color: 'rgba(255,183,0,0.3)', fontStyle: 'italic', fontWeight: 800 }}>NEED</div>
            )}
        </div>
    );
}

// ── Roster Side Panel ──────────────────────────────────────────────────
function RosterSidebar({ cuts, onDrop, onDragStart, onSign, masterPlayers, draftedPlayers }) {
    return (
        <div style={{ width: 230, borderLeft: '2px solid rgba(255,255,255,0.15)', display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.3)', flexShrink: 0 }}>
            <button
                onClick={onSign}
                className="action-pill"
                style={{ margin: 15, background: 'var(--chiefs-gold)', color: '#000', fontWeight: 900, borderRadius: 8, height: 45, fontSize: '0.85rem' }}
            >+ SIGN PLAYER</button>

            <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => onDrop(e, { posId: '__cut__', slotIdx: -1, targetZone: 'cut' })}
                style={{ flex: 1, padding: '0 15px', overflowY: 'auto' }}
            >
                <div style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 15, borderBottom: '2px solid var(--chiefs-red)', paddingBottom: 6, fontFamily: "'Outfit', sans-serif" }}>
                    CUT PANEL — {cuts.length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
    const [isPasting, setIsPasting] = useState(false);
    const [pastedHtml, setPastedHtml] = useState('');

    const isDraftComplete = (currentPick || 1) > 257;

    const setState = useCallback(next => {
        setStateRaw(prev => {
            const result = typeof next === 'function' ? next(prev) : next;
            saveState(result);
            return result;
        });
    }, []);

    const handleSignPlayer = (customPlayer) => {
        if (onDraft) onDraft(customPlayer);
        setState(prev => ({ ...prev, reserve: [...prev.reserve, customPlayer.name] }));
    };

    const handleDrop = useCallback((e, dst) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('application/json');
        if (!raw) return;
        const src = JSON.parse(raw);
        if (src.posId === dst.posId && src.slotIdx === dst.slotIdx) return;

        setState(prev => {
            const next = { ...prev, depthChart: { ...prev.depthChart }, reserve: [...prev.reserve], cuts: [...prev.cuts] };
            const dc = next.depthChart;

            if (src.posId === '__ir__') {
                next.reserve.splice(src.slotIdx, 1);
            } else if (src.posId === '__cut__') {
                next.cuts.splice(src.slotIdx, 1);
            } else {
                dc[src.posId][src.slotIdx] = null;
                // Don't auto-pop, keep indices stable
            }

            if (dst.posId === '__ir__') {
                next.reserve.push(src.slot.name);
            } else if (dst.posId === '__cut__') {
                next.cuts.push(src.slot.name);
            } else {
                if (!dc[dst.posId]) dc[dst.posId] = [];
                dc[dst.posId][dst.slotIdx] = makeSlot(src.slot.name, dst.targetZone);
            }
            return next;
        });
    }, [setState]);

    const handleDragStart = (e, data) => {
        e.dataTransfer.setData('application/json', JSON.stringify(data));
    };

    const handleAddPosition = (phase) => {
        const label = prompt('Position label:');
        if (!label) return;
        const id = `${phase[0].toUpperCase()}-${label}-${Date.now()}`;
        setState(prev => ({
            ...prev,
            positionConfig: { ...prev.positionConfig, [phase]: [...prev.positionConfig[phase], { id, label, slots53: 2 }] }
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
            <div style={{ background: 'var(--bg-color)', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 25, backgroundImage: 'radial-gradient(circle at center, rgba(255,183,0,0.05) 0%, transparent 70%)' }}>
                <div style={{ color: 'var(--chiefs-gold)', fontSize: '2rem', fontWeight: 900, fontFamily: "'Outfit', sans-serif", letterSpacing: '0.1em', textShadow: '0 0 20px rgba(255,183,0,0.3)' }}>INITIALIZE ROSTER</div>
                
                {!isPasting ? (
                    <>
                        <div style={{ display: 'flex', gap: 15, flexWrap: 'wrap', justifyContent: 'center' }}>
                            <button onClick={handleFetchOurlads} style={{ ...btnStyle, background: 'var(--chiefs-gold)', color: '#000', padding: '15px 30px', fontSize: '1rem', fontWeight: 900, boxShadow: '0 4px 15px rgba(255,183,0,0.4)' }}>
                                Auto-Fetch Depth Chart
                            </button>
                            <button onClick={handleFetchLocal} style={{ ...btnStyle, padding: '15px 30px', fontSize: '1rem' }}>
                                Load Default Roster
                            </button>
                            <button onClick={() => setIsPasting(true)} style={{ ...btnStyle, padding: '15px 30px', fontSize: '1rem' }}>
                                Paste HTML source
                            </button>
                            <label style={{ ...btnStyle, padding: '15px 30px', fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                Upload CSV
                                <input type="file" accept=".csv" onChange={handleBootstrap} style={{ display: 'none' }} />
                            </label>
                        </div>
                    </>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 15, width: '100%', maxWidth: 600 }}>
                        <textarea
                            placeholder="Paste Ourlads source (Ctrl+U from the site)..."
                            value={pastedHtml}
                            onChange={e => setPastedHtml(e.target.value)}
                            style={{ height: 250, background: 'rgba(0,0,0,0.5)', border: '2px solid rgba(255,183,0,0.2)', color: '#fff', borderRadius: 12, padding: 15, fontSize: '0.8rem', fontFamily: 'monospace' }}
                        />
                        <div style={{ display: 'flex', gap: 15 }}>
                            <button onClick={handlePasteHtml} style={{ ...btnStyle, flex: 1, background: 'var(--chiefs-gold)', color: '#000', height: 50, fontWeight: 900 }}>Process HTML</button>
                            <button onClick={() => setIsPasting(false)} style={{ ...btnStyle, flex: 1, height: 50 }}>Cancel</button>
                        </div>
                    </div>
                )}
                <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem', textAlign: 'center', maxWidth: 500, lineHeight: 1.6, fontStyle: 'italic' }}>
                    Automate your roster setup by fetching the latest depth chart directly,<br/>or use your manual baseline files.
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

    const getCounterColor = (val, max) => {
        if (val === max) return '#4ade80';
        if (val < max) return '#fbbf24';
        return 'var(--chiefs-red)';
    };

    return (
        <div style={{ background: 'var(--bg-color)', height: '100%', display: 'flex', flexDirection: 'column', color: 'var(--text-main)', fontFamily: 'Inter, sans-serif', overflow: 'hidden' }}>
            {/* Toolbar */}
            <div className='top-panel' style={{
                display: 'flex', alignItems: 'center', padding: '0 30px', height: 90,
                background: 'linear-gradient(to right, rgba(227, 24, 55, 0.2), rgba(0,0,0,0.6))',
                borderBottom: '3px solid var(--chiefs-gold)', gap: 30, flexShrink: 0
            }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 900, letterSpacing: '0.08em', color: '#fff', fontFamily: "'Outfit', sans-serif", textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}>CHIEFS KINGDOM ROSTER</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--chiefs-gold)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.3em' }}>MANAGEMENT CONSOLE</div>
                </div>

                <div style={{ flex: 1 }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: '5px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <CounterBox label="53-MAN" val={destined53} max={53} color={getCounterColor(destined53, 53)} />
                    <CounterBox label="PRACTICE SQUAD" val={psCount} max={16} color={getCounterColor(psCount, 16)} />
                    <CounterBox label="TOTAL SQUAD" val={total} max={91} color={getCounterColor(total, 91)} isLast />
                </div>

                <div style={{ display: 'flex', gap: 12, marginLeft: 20 }}>
                    <button onClick={handleExport} style={{ ...btnStyle, padding: '8px 16px' }}>Export CSV</button>
                    <button onClick={() => { if (confirm('Reset roster?')) { setState(defaultState()); setBootstrapping(true); } }} style={{ ...btnStyle, padding: '8px 16px', color: 'var(--chiefs-red)', borderColor: 'rgba(227,24,55,0.3)' }}>Reset</button>
                </div>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <div style={{ flex: 1, padding: '10px 24px 40px', overflowY: 'auto', minHeight: 0, minWidth: 0, background: 'radial-gradient(circle at top right, rgba(227,24,55,0.05) 0%, transparent 60%)' }}>
                    <SectionHeader label="OFFENSE" count={oCount} onAdd={() => handleAddPosition('offense')} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 40 }}>
                        <DepthHeader />
                        {positionConfig.offense.map((p, idx) => (
                            <DepthRow key={p.id} idx={idx} phase="offense" posConfig={p} slots={depthChart[p.id] ?? []} onDragStart={handleDragStart} onDrop={handleDrop} onConfigChange={val => handleSlotsChange(p.id, val)} onDeletePosition={() => updateOffenseConfig(positionConfig.offense.filter(x => x.id !== p.id))} onRowDragStart={handleRowDragStart} onRowDrop={handleRowDrop} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                        ))}
                    </div>

                    <SectionHeader label="DEFENSE" count={dCount} onAdd={() => handleAddPosition('defense')} style={{ marginTop: 60 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 40 }}>
                        <DepthHeader />
                        {positionConfig.defense.map((p, idx) => (
                            <DepthRow key={p.id} idx={idx} phase="defense" posConfig={p} slots={depthChart[p.id] ?? []} onDragStart={handleDragStart} onDrop={handleDrop} onConfigChange={val => handleSlotsChange(p.id, val)} onDeletePosition={() => updateDefenseConfig(positionConfig.defense.filter(x => x.id !== p.id))} onRowDragStart={handleRowDragStart} onRowDrop={handleRowDrop} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                        ))}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 60, padding: '24px', background: 'rgba(0,0,0,0.3)', borderRadius: 12, border: '2px solid var(--chiefs-red)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
                        <div style={{ display: 'flex', gap: 12 }}>
                            {SPECIALIST_IDS.map(id => (
                                <SpecialistCell key={id} id={id} slot={depthChart[id]?.[0] ?? null} onDragStart={handleDragStart} onDrop={handleDrop} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                            ))}
                        </div>
                        <div style={{ flex: 1 }} />
                        {needs > 0 && <div style={{ fontSize: '1rem', color: 'var(--chiefs-gold)', fontWeight: 900, fontFamily: "'Outfit', sans-serif", letterSpacing: '0.1em' }}>REMAINING NEEDS: {needs}</div>}
                    </div>

                    <div onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, { posId: '__ir__', slotIdx: -1, targetZone: 'ir' })} style={{ padding: '20px 0', borderTop: '2px solid rgba(255,255,255,0.1)', marginTop: 30 }}>
                        <div style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--chiefs-red)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 15, fontFamily: "'Outfit', sans-serif" }}>INJURY RESERVE — {reserve.length}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                            {reserve.map((name, i) => (
                                <SlotCell key={i} slot={{ name, zone: 'ir' }} zone="ir" posId="__ir__" slotIdx={i} targetZone="ir" onDragStart={handleDragStart} onDrop={handleDrop} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                            ))}
                        </div>
                    </div>
                </div>

                <RosterSidebar cuts={cuts} onDragStart={handleDragStart} onDrop={handleDrop} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} onSign={() => setIsSignModalOpen(true)} />
            </div>

            <UnrankedModal isOpen={isSignModalOpen} onClose={() => setIsSignModalOpen(false)} onDraft={handleSignPlayer} isUDFAVersion={isDraftComplete} />
        </div>
    );
}

function DepthHeader() {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: `70px 60px repeat(${MAX_DISPLAY_SLOTS}, 175px)`, gap: 6, marginBottom: 5 }}>
            <div className="depth-h">Pos</div><div className="depth-h">Slots</div>
            {Array.from({ length: MAX_DISPLAY_SLOTS }, (_, i) => (
                <div key={i} className="depth-h">Slot {i+1}</div>
            ))}
            <style>{`.depth-h { font-size: 0.65rem; font-weight: 900; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.1em; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 5px; }`}</style>
        </div>
    );
}

function CounterBox({ label, val, max, color, isLast }) {
    return (
        <div style={{ textAlign: 'center', padding: '0 25px', borderRight: isLast ? 'none' : '1px solid rgba(255,255,255,0.15)', height: '45px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 900, color, textShadow: `0 0 15px ${color}55` }}>{val} <span style={{ fontSize: '0.85rem', opacity: 0.4 }}>/ {max === 91 ? '90+1' : max}</span></div>
        </div>
    );
}

function SectionHeader({ label, count, onAdd, style }) {
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', padding: '15px 0 10px', borderBottom: '3px solid var(--chiefs-red)', marginBottom: 15, fontFamily: "'Outfit', sans-serif", ...style }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '0.15em', color: '#fff', textTransform: 'uppercase', textShadow: '0 0 10px rgba(255,255,255,0.1)' }}>{label}</div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--chiefs-gold)', marginRight: 20 }}>{count}</div>
            {onAdd && <button onClick={onAdd} className="action-pill" style={{ padding: '6px 15px', fontSize: '0.8rem', fontWeight: 800 }}>+ Add Position</button>}
        </div>
    );
}

const btnStyle = {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 8,
    color: 'var(--text-main)',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 700,
    transition: 'all 0.2s ease',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
};
