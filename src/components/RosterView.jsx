import React, { useState, useCallback, useRef, useEffect } from 'react';

// ── Zone colour tokens ────────────────────────────────────────────────────
const ZONE_STYLE = {
    '53': { color: 'var(--text-main)', border: '1px solid rgba(255,183,0,0.6)', bg: 'var(--panel-bg)' },
    ps: { color: 'var(--text-main)', border: '1px solid rgba(59,130,246,0.6)', bg: 'var(--panel-bg)' },
    ir: { color: 'var(--text-main)', border: '1px solid rgba(239,68,68,0.5)', bg: 'var(--panel-bg)' },
    r: { color: 'var(--text-main)', border: '1px solid rgba(171, 171, 171, 0.5)', bg: 'var(--panel-bg)' },
    need: { border: '1px dashed rgba(255,183,0,0.8)', bg: 'rgba(255,183,0,0.03)' },
    empty: { border: '1px dashed rgba(255,255,255,0.1)', bg: 'transparent' },
};
import {
    loadState, saveState, defaultState,
    parseCSV, exportCSV, makeSlot, resolvePosition,
    SPECIALIST_IDS
} from '../utils/rosterState';

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
function SlotCell({ slot, zone, posId, slotIdx, targetZone, onDragStart, onDrop, onDragOver, onClick }) {
    const isNeed = !slot && zone === '53';
    const zStyle = slot ? ZONE_STYLE[slot.zone ?? zone] : (isNeed ? ZONE_STYLE.need : ZONE_STYLE.empty);
    const { displayName, suffix, nameColor } = parseName(slot?.name, zStyle.color);

    return (
        <div
            draggable={!!slot}
            onDragStart={e => slot && onDragStart(e, { posId, slotIdx, slot })}
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => onDrop(e, { posId, slotIdx, targetZone: targetZone ?? zone })}
            onClick={() => slot && onClick && onClick(slot, posId, slotIdx)}
            style={{
                width: 150, // Fixed width to ensure neat stacking
                height: 36,
                borderRadius: 6,
                border: zStyle.border,
                background: zStyle.bg,
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                cursor: slot ? 'grab' : 'default',
                userSelect: 'none',
                flexShrink: 0,
                transition: 'opacity .15s',
            }}
        >
            {slot ? (
                <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: nameColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayName}
                    </span>
                    {suffix && (
                        <span style={{ fontSize: '0.65rem', color: '#ff0000', fontWeight: 800, marginLeft: 4 }}>
                            {suffix}
                        </span>
                    )}
                </div>
            ) : isNeed ? (
                <span style={{ fontSize: '0.65rem', color: 'rgba(255,183,0,0.5)', fontStyle: 'italic' }}>NEED</span>
            ) : null}
        </div>
    );
}

// ── Single row in depth chart ────────────────────────────────────────────────
function DepthRow({ posConfig, slots, onDragStart, onDrop, onDragOver, idx, phase, onConfigChange, onDeletePosition, onRowDragStart, onRowDrop }) {
    const { id, label, slots53 } = posConfig;

    // Pad slots array to ensure we always have enough cells for the 53-man threshold
    const filledSlots = [...slots];
    while (filledSlots.length < slots53) filledSlots.push(null);

    const enriched = filledSlots.map((s, i) => ({
        slot: s,
        zone: i < slots53 ? '53' : (s?.zone ?? 'r'),
        idx: i,
    }));

    const slots53Items = enriched.slice(0, slots53);
    const overflowItems = enriched.slice(slots53);
    const psItems = overflowItems.filter(e => e.zone === 'ps');
    const rItems = overflowItems.filter(e => e.zone === 'r');

    return (
        <>
            {/* Position Header / Configurator */}
            <div
                draggable
                onDragStart={e => onRowDragStart(e, idx, phase)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => onRowDrop(e, idx, phase)}
                style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(255,183,0,0.03)',
                    borderBottom: '1px solid rgba(255,255,255,0.05)', borderRight: '2px solid rgba(255,183,0,0.2)',
                    padding: '4px', minHeight: 44,
                    cursor: 'grab', userSelect: 'none', gap: 2,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#ffffffff' }}>{label}</span>
                    <button
                        onClick={onDeletePosition}
                        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: '1.2rem', padding: 0, lineHeight: 1, marginBottom: '0.5rem', marginLeft: '0.3rem' }}
                    >×</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: '0.65rem', color: 'rgba(255, 183, 0, 1)' }}>
                    <span>53:</span>
                    <input
                        type="number" min={0} max={10} value={slots53}
                        onChange={e => onConfigChange(Math.max(0, parseInt(e.target.value) || 0))}
                        onClick={e => e.stopPropagation()}
                        style={{ width: 28, background: 'transparent', border: 'none', color: '#ff0000ff', fontWeight: 700, fontSize: '0.7rem', textAlign: 'center', padding: 0 }}
                    />
                </div>
            </div>

            {/* 53-Man Panel */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', overflowX: 'auto', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: 12, padding: '4px 12px 4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', minHeight: 44 }}>
                {slots53Items.map(({ slot, zone, idx }) => (
                    <SlotCell
                        key={idx} slot={slot} zone={zone} posId={id} slotIdx={idx} targetZone="53"
                        onDragStart={onDragStart} onDrop={onDrop} onDragOver={onDragOver}
                    />
                ))}
            </div>

            {/* Practice Squad Panel */}
            <div
                onDragOver={e => { e.preventDefault(); onDragOver && onDragOver(e); }}
                onDrop={e => {
                    if (e.target === e.currentTarget) {
                        onDrop(e, { posId: id, slotIdx: -1, targetZone: "ps" });
                    }
                }}
                style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', overflowX: 'auto', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: 12, padding: '4px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', minHeight: 44, minWidth: 60 }}
            >
                {psItems.map(({ slot, zone, idx }) => (
                    <SlotCell
                        key={idx} slot={slot} zone={zone} posId={id} slotIdx={idx} targetZone="ps"
                        onDragStart={onDragStart} onDrop={onDrop} onDragOver={onDragOver}
                    />
                ))}
            </div>

            {/* Cut Panel */}
            <div
                onDragOver={e => { e.preventDefault(); onDragOver && onDragOver(e); }}
                onDrop={e => {
                    if (e.target === e.currentTarget) {
                        onDrop(e, { posId: id, slotIdx: -1, targetZone: "r" });
                    }
                }}
                style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', overflowX: 'auto', padding: '4px 12px 4px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', minHeight: 44, minWidth: 60 }}
            >
                {rItems.map(({ slot, zone, idx }) => (
                    <SlotCell
                        key={idx} slot={slot} zone={zone} posId={id} slotIdx={idx} targetZone="r"
                        onDragStart={onDragStart} onDrop={onDrop} onDragOver={onDragOver}
                    />
                ))}
            </div>
        </>
    );
}

// ── IR Section ─────────────────────────────────────────────────────────────
function IRSection({ irPlayers, onDrop, onDragStart }) {
    return (
        <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => onDrop(e, { posId: '__ir__', slotIdx: -1, targetZone: 'ir' })}
            style={{ padding: '8px 12px', borderTop: '2px solid rgba(255,255,255,0.08)', marginTop: 8 }}
        >
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'rgba(228, 93, 93, 0.8)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Injured/Reserve — {irPlayers.length}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {irPlayers.map((name, i) => {
                    const { displayName, suffix, nameColor } = parseName(name, 'rgba(228, 93, 93, 1)');
                    return (
                        <div
                            key={i}
                            draggable
                            onDragStart={e => onDragStart(e, { posId: '__ir__', slotIdx: i, slot: { name, zone: 'ir' } })}
                            style={{
                                padding: '3px 10px', borderRadius: 20,
                                border: '1px solid rgba(239,68,68,0.5)',
                                background: 'rgba(239,68,68,0.06)',
                                fontSize: '0.75rem', color: nameColor,
                                cursor: 'grab', userSelect: 'none',
                                display: 'flex', alignItems: 'center', gap: 4
                            }}
                        >
                            <span>{displayName}</span>
                            {suffix && <span style={{ fontSize: '0.6rem', color: '#ff0000', fontWeight: 800 }}>{suffix}</span>}
                        </div>
                    );
                })}
                {irPlayers.length === 0 && (
                    <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>Drop injured players here</span>
                )}
            </div>
        </div>
    );
}


// ── Specialist cell ────────────────────────────────────────────────────────
function SpecialistCell({ id, slot, onDragStart, onDrop }) {
    const label = { P: 'Punter', K: 'Kicker', LS: 'Long Snapper' }[id] ?? id;
    return (
        <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => onDrop(e, { posId: id, slotIdx: 0 })}
            style={{
                width: 160, padding: '6px 10px', borderRadius: 8,
                border: slot ? ZONE_STYLE['53'].border : ZONE_STYLE.need.border,
                background: slot ? ZONE_STYLE['53'].bg : ZONE_STYLE.need.bg,
                display: 'flex', flexDirection: 'column', gap: 2,
            }}
        >
            <div style={{ fontSize: '0.65rem', color: 'rgba(255,183,0,0.6)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
            {slot ? (() => {
                const { displayName, suffix, nameColor } = parseName(slot.name);
                return (
                    <div
                        draggable
                        onDragStart={e => onDragStart(e, { posId: id, slotIdx: 0, slot })}
                        style={{ fontSize: '0.8rem', fontWeight: 700, color: nameColor, cursor: 'grab', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                        <span>{displayName}</span>
                        {suffix && <span style={{ fontSize: '0.65rem', color: '#ff0000', fontWeight: 800 }}>{suffix}</span>}
                    </div>
                );
            })() : (
                <div style={{ fontSize: '0.7rem', color: 'rgba(255,183,0,0.4)', fontStyle: 'italic' }}>NEED</div>
            )}
        </div>
    );
}

// ── Main RosterView ────────────────────────────────────────────────────────
export default function RosterView() {
    const [state, setStateRaw] = useState(() => loadState() ?? defaultState());
    const [bootstrapping, setBootstrapping] = useState(() => loadState() === null);

    // ALL hooks must be declared before any early return
    const dragSrc = useRef(null);
    const dragRow = useRef(null);

    const setState = useCallback(updater => {
        setStateRaw(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            saveState(next);
            return next;
        });
    }, []);

    // Auto-fetch /roster.csv if no localStorage state exists
    useEffect(() => {
        if (!bootstrapping) return;
        const base = import.meta.env.BASE_URL;
        fetch(`${base}roster.csv`)
            .then(r => r.ok ? r.text() : Promise.reject(r.status))
            .then(text => { setState(parseCSV(text)); })
            .catch(() => { })
            .finally(() => setBootstrapping(false));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleDragStart = useCallback((e, src) => {
        dragSrc.current = src;
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleDrop = useCallback((e, dst) => {
        e.preventDefault();
        const src = dragSrc.current;
        if (!src || !src.slot) return;
        dragSrc.current = null;

        setState(prev => {
            const next = structuredClone(prev);
            const dc = next.depthChart;

            // Remove from source
            if (src.posId === '__ir__') {
                next.reserve.splice(src.slotIdx, 1);
            } else {
                dc[src.posId][src.slotIdx] = null;
                // Trim trailing nulls
                while (dc[src.posId].length && dc[src.posId][dc[src.posId].length - 1] === null)
                    dc[src.posId].pop();
            }

            // Insert at destination
            if (dst.posId === '__ir__') {
                next.reserve.push(src.slot.name);
            } else {
                if (!dc[dst.posId]) dc[dst.posId] = [];
                const targetIdx = dst.slotIdx === -1 ? dc[dst.posId].length : dst.slotIdx;

                // Determine zone for destination based on explicit targetZone or threshold
                const posConf = [...next.positionConfig.offense, ...next.positionConfig.defense]
                    .find(p => p.id === dst.posId);
                const zone = dst.targetZone ?? (posConf && targetIdx < posConf.slots53 ? '53' : 'r');
                const newSlot = { name: src.slot.name, zone };

                if (dst.slotIdx === -1) {
                    dc[dst.posId].push(newSlot);
                } else {
                    // Displace existing card
                    const existing = dc[dst.posId][targetIdx];
                    dc[dst.posId][targetIdx] = newSlot;
                    if (existing) {
                        // If bumping it makes it spill outside slots53, make sure it renders in Cut
                        existing.zone = 'r';
                        // Push to the end of the line
                        dc[dst.posId].push(existing);
                    }
                }
            }
            return next;
        });
    }, [setState]);

    const handleSlotsChange = useCallback((posId, newSlots53) => {
        setState(prev => {
            const next = structuredClone(prev);
            if (!next.depthChart[posId]) return next;

            const dcRow = next.depthChart[posId];
            const p53 = [], pPS = [], pR = [];

            // Bucket players
            for (let i = 0; i < dcRow.length; i++) {
                if (!dcRow[i]) continue;
                // Before change, any player stored in array at index < OLD slots53 was 53-man
                // We rely on their stored `zone`!
                if (dcRow[i].zone === 'ps') pPS.push(dcRow[i]);
                else if (dcRow[i].zone === 'r') pR.push(dcRow[i]);
                else p53.push(dcRow[i]); // Either zone 53, or an unknown fallback
            }

            // If we are shrinking, players at the end of p53 fall off into PS!
            while (p53.length > newSlots53) {
                const pushedOut = p53.pop();
                pushedOut.zone = 'ps';
                pPS.unshift(pushedOut);
            }

            // If we are expanding, pull players from PS, then R
            while (p53.length < newSlots53 && (pPS.length > 0 || pR.length > 0)) {
                if (pPS.length > 0) {
                    const pulled = pPS.shift();
                    pulled.zone = '53';
                    p53.push(pulled);
                } else if (pR.length > 0) {
                    const pulled = pR.shift();
                    pulled.zone = '53';
                    p53.push(pulled);
                }
            }

            // Pad p53 array out with nulls to ensure exact size up to threshold
            while (p53.length < newSlots53) p53.push(null);

            next.depthChart[posId] = [...p53, ...pPS, ...pR];
            return next;
        });
    }, [setState]);

    // ── Config changes ─────────────────────────────────────────────────────
    const updateOffenseConfig = useCallback(positions => {
        setState(prev => ({ ...prev, positionConfig: { ...prev.positionConfig, offense: positions } }));
    }, [setState]);

    const updateDefenseConfig = useCallback(positions => {
        setState(prev => ({ ...prev, positionConfig: { ...prev.positionConfig, defense: positions } }));
    }, [setState]);

    const handleAddPosition = useCallback((phase) => {
        const posLabel = prompt('Position label (e.g. DE, CB, WR.4):');
        if (!posLabel?.trim()) return;
        const addLabel = posLabel.trim();
        const newId = `${addLabel}-${Date.now()}`;

        if (phase === 'offense') {
            updateOffenseConfig([...state.positionConfig.offense, { id: newId, label: addLabel, slots53: 1 }]);
        } else {
            updateDefenseConfig([...state.positionConfig.defense, { id: newId, label: addLabel, slots53: 1 }]);
        }
    }, [state.positionConfig, updateOffenseConfig, updateDefenseConfig]);

    const handleRowDragStart = useCallback((e, idx, phase) => {
        dragRow.current = { idx, phase };
        e.stopPropagation();
    }, []);

    const handleRowDrop = useCallback((e, targetIdx, phase) => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragRow.current || dragRow.current.phase !== phase || dragRow.current.idx === targetIdx) return;

        const isOffense = phase === 'offense';
        const next = isOffense ? [...state.positionConfig.offense] : [...state.positionConfig.defense];
        const [moved] = next.splice(dragRow.current.idx, 1);
        next.splice(targetIdx, 0, moved);

        if (isOffense) updateOffenseConfig(next);
        else updateDefenseConfig(next);

        dragRow.current = null;
    }, [state.positionConfig, updateOffenseConfig, updateDefenseConfig]);

    // ── CSV import ─────────────────────────────────────────────────────────
    const handleImport = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.csv,text/csv';
        input.onchange = async e => {
            const text = await e.target.files[0].text();
            setState(parseCSV(text));
        };
        input.click();
    }, [setState]);


    // ── CSV export ─────────────────────────────────────────────────────────
    const handleExport = useCallback(() => {
        const csv = exportCSV(state);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'roster.csv';
        a.click(); URL.revokeObjectURL(url);
    }, [state]);

    // ── Counters ───────────────────────────────────────────────────────────
    const { positionConfig, depthChart, reserve } = state;
    const allPos = [...positionConfig.offense, ...positionConfig.defense];

    let destined53 = 0, psCount = 0, oCount = 0, dCount = 0, total = 0, needs = 0;
    let oTotal = 0, oPS = 0, dTotal = 0, dPS = 0;

    positionConfig.offense.forEach(p => {
        const slots = depthChart[p.id] ?? [];
        slots.forEach((s, i) => {
            if (s) {
                total++; oTotal++;
                if (i < p.slots53 || s.zone === '53') oCount++;
                if (s.zone === 'ps') { psCount++; oPS++; }
            } else if (i < p.slots53) {
                needs++;
            }
        });
        for (let i = slots.length; i < p.slots53; i++) needs++;
    });
    positionConfig.defense.forEach(p => {
        const slots = depthChart[p.id] ?? [];
        slots.forEach((s, i) => {
            if (s) {
                total++; dTotal++;
                if (i < p.slots53 || s.zone === '53') dCount++;
                if (s.zone === 'ps') { psCount++; dPS++; }
            } else if (i < p.slots53) {
                needs++;
            }
        });
        for (let i = slots.length; i < p.slots53; i++) needs++;
    });
    destined53 = oCount + dCount;
    SPECIALIST_IDS.forEach(id => {
        const s = depthChart[id]?.[0];
        if (s) { destined53++; total++; }
        else needs++;
    });
    total += reserve.length;

    return (
        <div style={{ background: 'var(--bg-color)', height: '100%', overflowY: 'auto', color: 'var(--text-main)', fontFamily: 'Inter, sans-serif' }}>
            {/* Toolbar */}
            <div className='top-panel' style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: '2px solid rgba(255, 0, 0, 0.2)' }}>
                <h2 style={{ margin: 0, fontSize: '2rem', fontWeight: 800, color: '#ffffffff', letterSpacing: '0.05em' }}>ROSTER</h2>
                <div style={{ flex: 1, textAlign: 'right', fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-dim)', display: 'flex', justifyContent: 'flex-end', gap: 24, paddingRight: 16 }}>
                    <span>Total: <strong style={{ color: 'var(--text-main)' }}>{total}</strong> / 90</span>
                    <span>Practice Squad: <strong style={{ color: 'var(--text-main)' }}>{psCount}</strong> / 16+1</span>
                    <span>Roster: <strong style={{ color: 'var(--text-main)' }}>{destined53}</strong> / 53</span>
                </div>
                <button onClick={handleImport} style={btnStyle}>⬆ Import CSV</button>
                <button onClick={handleExport} style={btnStyle}>⬇ Export CSV</button>
                <button onClick={() => {
                    fetch('/roster.csv')
                        .then(r => r.ok ? r.text() : Promise.reject(r.status))
                        .then(text => setState(parseCSV(text)))
                        .catch(() => setState(defaultState()));
                }} style={{ ...btnStyle, color: 'rgba(255,100,100,0.8)' }}>↺ Reset</button>
            </div>

            <div style={{ padding: '0 16px 24px', overflowX: 'auto' }}>
                {/* OFFENSE */}
                <SectionHeader label="OFFENSE" count={oCount} onAdd={() => handleAddPosition('offense')} />
                <div style={{ display: 'grid', gridTemplateColumns: '70px max-content max-content max-content', alignItems: 'stretch' }}>
                    <div />
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)', padding: '0 12px 4px', letterSpacing: '0.08em', textAlign: 'left', alignSelf: 'end' }}>53-MAN ROSTER</div>
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)', padding: '0 12px 4px', letterSpacing: '0.08em', textAlign: 'left', alignSelf: 'end' }}>PRACTICE SQUAD</div>
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)', padding: '0 12px 4px', letterSpacing: '0.08em', textAlign: 'left', alignSelf: 'end' }}>EXTENDED ROSTER</div>

                    {positionConfig.offense.map((p, idx) => (
                        <DepthRow
                            key={p.id}
                            posConfig={p}
                            slots={depthChart[p.id] ?? []}
                            onDragStart={handleDragStart}
                            onDrop={handleDrop}
                            idx={idx}
                            phase="offense"
                            onConfigChange={val => {
                                handleSlotsChange(p.id, val);
                                updateOffenseConfig(positionConfig.offense.map(x => x.id === p.id ? { ...x, slots53: val } : x));
                            }}
                            onDeletePosition={() => updateOffenseConfig(positionConfig.offense.filter(x => x.id !== p.id))}
                            onRowDragStart={handleRowDragStart}
                            onRowDrop={handleRowDrop}
                        />
                    ))}
                </div>

                {/* DEFENSE */}
                <SectionHeader label="DEFENSE" count={dCount} style={{ marginTop: 24 }} onAdd={() => handleAddPosition('defense')} />
                <div style={{ display: 'grid', gridTemplateColumns: '70px max-content max-content max-content', alignItems: 'stretch' }}>
                    <div />
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)', padding: '0 12px 4px', letterSpacing: '0.08em', textAlign: 'left', alignSelf: 'end' }}>53-MAN ROSTER</div>
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)', padding: '0 12px 4px', letterSpacing: '0.08em', textAlign: 'left', alignSelf: 'end' }}>PRACTICE SQUAD</div>
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)', padding: '0 12px 4px', letterSpacing: '0.08em', textAlign: 'left', alignSelf: 'end' }}>EXTENDED ROSTER</div>

                    {positionConfig.defense.map((p, idx) => (
                        <DepthRow
                            key={p.id}
                            posConfig={p}
                            slots={depthChart[p.id] ?? []}
                            onDragStart={handleDragStart}
                            onDrop={handleDrop}
                            idx={idx}
                            phase="defense"
                            onConfigChange={val => {
                                handleSlotsChange(p.id, val);
                                updateDefenseConfig(positionConfig.defense.map(x => x.id === p.id ? { ...x, slots53: val } : x));
                            }}
                            onDeletePosition={() => updateDefenseConfig(positionConfig.defense.filter(x => x.id !== p.id))}
                            onRowDragStart={handleRowDragStart}
                            onRowDrop={handleRowDrop}
                        />
                    ))}
                </div>

                {/* SPECIALISTS + COUNTERS */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 16, flexWrap: 'wrap', borderTop: '2px solid rgba(255, 0, 0, 0.2)', paddingTop: 12 }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                        {SPECIALIST_IDS.map(id => (
                            <SpecialistCell
                                key={id} id={id}
                                slot={depthChart[id]?.[0] ?? null}
                                onDragStart={handleDragStart}
                                onDrop={handleDrop}
                            />
                        ))}
                    </div>
                    <div style={{ flex: 1 }} />
                    <div style={{ textAlign: 'right', lineHeight: 1.7 }}>
                        {needs > 0 && <div style={{ fontSize: '0.75rem', color: 'rgba(255,183,0,0.7)' }}>Needs: {needs}</div>}
                    </div>
                </div>

                {/* IR SECTION */}
                <IRSection
                    irPlayers={reserve}
                    onDragStart={handleDragStart}
                    onDrop={handleDrop}
                />
            </div>
        </div >
    );
}

function SectionHeader({ label, count, onAdd, style }) {
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', padding: '10px 0 6px', borderBottom: '2px solid rgba(255, 0, 0, 0.25)', marginBottom: 8, ...style }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '0.08em', color: '#ffffffff', textTransform: 'uppercase' }}>
                {label}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)', opacity: 0.9, marginRight: 16 }}>{count}</div>
            {onAdd && (
                <button
                    onClick={onAdd}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '3px 10px', fontSize: '0.75rem' }}
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
