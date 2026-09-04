import React, { useState, useCallback } from 'react';
import {
    DndContext, DragOverlay, useDraggable, useDroppable,
    useSensor, useSensors, MouseSensor, TouchSensor
} from '@dnd-kit/core';
import { SPECIALIST_IDS, POS_TRANSLATIONS } from '../utils/rosterState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';
import { parseName } from '../utils/formatName';

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
            className={`rv-slot ${slot ? 'filled' : 'empty-square'} ${zoneClass(slot?.zone ?? zone, isNeed)} ${isOver ? 'drag-over' : ''} ${isDragging ? 'dragging-source' : ''}`}
            style={slot ? { cursor: 'grab' } : undefined}
        >
            {slot ? (
                <SlotCardContent {...meta} />
            ) : (
                <span className="rv-slot-add-icon">+</span>
            )}
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

    // Build slot arrays for each zone.
    //
    // Every zone renders a CONTIGUOUS window of array indices, so a slot's
    // rendered position always equals its index in `slots`. Cutting or
    // dragging a player out leaves a null hole mid-array, and two earlier
    // bugs both came from treating those holes as if they didn't exist:
    // the practice-squad list skipped holes but then derived the trailing
    // empty cell's index from how many items it had *rendered*, so with a
    // hole present that index collided with a real occupied slot (giving
    // two cells the same droppable id — an empty cell that, when dropped
    // on, hit the occupied slot instead); and the reserve list stopped at
    // the first hole, hiding every player after it, so moving a reserve
    // player one cell down made him vanish.
    const s53 = Math.max(slots53, 1);
    const slots53Items = Array.from({ length: s53 }, (_, i) => ({ slot: slots[i] || null, zone: '53', idx: i }));

    const psStart = s53;
    const psItems = Array.from({ length: PS_SLOTS }, (_, i) => ({ slot: slots[psStart + i] || null, zone: 'ps', idx: psStart + i }));

    // Reserve has no fixed cap, so its window runs to the last occupied
    // index (scanning the whole tail, not stopping at the first hole) plus
    // one trailing empty cell to drop into.
    const rStart = s53 + PS_SLOTS;
    let rLastOccupied = -1;
    for (let i = rStart; i < slots.length; i++) { if (slots[i]) rLastOccupied = i; }
    const rCount = (rLastOccupied === -1 ? 0 : rLastOccupied - rStart + 1) + 1;
    const rItems = Array.from({ length: rCount }, (_, i) => ({ slot: slots[rStart + i] || null, zone: 'r', idx: rStart + i }));

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
function SpecialistCell({ id, slot, masterPlayers, draftedPlayers, showNeeds }) {
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
                showNeeds && <div className="rv-specialist-need">NEED</div>
            )}
        </div>
    );
}

// ── Roster Side Panel ── Cut panel only (IR is at bottom of main content)
function RosterSidebar({ cuts, onSign, signLabel, masterPlayers, draftedPlayers }) {
    const { setNodeRef, isOver } = useDroppable({
        id: 'drop-cut-zone',
        data: { kind: 'item', posId: '__cut__', slotIdx: cuts.length, targetZone: 'cut' },
    });
    return (
        <div className="roster-sidebar">
            {onSign && <button onClick={onSign} className="action-pill roster-sign-btn">{signLabel}</button>}

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

/**
 * Shared depth-chart grid: position rows with 53-man/practice-squad/reserve
 * slots, specialists, an IR zone, and a cuts sidebar — all drag-and-drop via
 * @dnd-kit (mouse distance-activated, touch delay-activated so a quick swipe
 * still scrolls normally; see the sensors below). Originally RosterView.jsx's
 * own internals; extracted so Free Agency's candidate board can render the
 * identical grid against its own state, per
 * /home/dev/.claude/plans/structured-growing-cat.md.
 *
 * Callers own their own state shape (positionConfig/depthChart/reserve/cuts)
 * and mutation logic — this component only renders and reports completed
 * drag operations via onMove/onRowMove.
 */
export default function DepthChartGrid({
    positionConfig, depthChart, reserve, cuts,
    masterPlayers, draftedPlayers,
    onMove, onRowMove, onDeletePosition, onSlotsChange, onAddPosition,
    onSignClick, signButtonLabel = '+ SIGN PLAYER',
    zoomLevel = 1, showNeeds = true,
}) {
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
            onRowMove(src.idx, src.phase, dst.idx, dst.phase);
        } else {
            onMove(src, dst);
        }
    }, [onMove, onRowMove]);

    const handleDragCancel = useCallback(() => setActiveDragData(null), []);

    let oCount = 0, dCount = 0, needs = 0;
    const calculateNeeds = (positions, isOffense) => {
        positions.forEach(p => {
            const slots = depthChart[p.id] ?? [];
            const s53 = Math.max(p.slots53, 1);
            slots.forEach((s, i) => {
                if (s && i < s53) { if (isOffense) oCount++; else dCount++; }
                else if (!s && i < s53) needs++;
            });
            for (let i = slots.length; i < s53; i++) needs++;
        });
    };
    calculateNeeds(positionConfig.offense, true);
    calculateNeeds(positionConfig.defense, false);
    SPECIALIST_IDS.forEach(id => { if (!depthChart[id]?.[0]) needs++; });

    return (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
            <div className="roster-body" style={{ zoom: zoomLevel }}>
                <div className="roster-main">
                    <div className="roster-section-header">
                        <div className="roster-section-title">OFFENSE</div>
                        <div className="roster-section-count">{oCount}</div>
                        <button onClick={() => onAddPosition('offense')} className="action-pill">+ Add Position</button>
                    </div>
                    <div className="roster-grid">
                        <DepthHeader />
                        {positionConfig.offense.map((p, idx) => (
                            <DepthRow key={p.id} idx={idx} phase="offense" posConfig={p} slots={depthChart[p.id] ?? []} onConfigChange={val => onSlotsChange(p.id, val)} onDeletePosition={() => onDeletePosition('offense', p.id)} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                        ))}
                    </div>

                    <div className="roster-section-header" style={{ marginTop: 60 }}>
                        <div className="roster-section-title">DEFENSE</div>
                        <div className="roster-section-count">{dCount}</div>
                        <button onClick={() => onAddPosition('defense')} className="action-pill">+ Add Position</button>
                    </div>
                    <div className="roster-grid">
                        <DepthHeader />
                        {positionConfig.defense.map((p, idx) => (
                            <DepthRow key={p.id} idx={idx} phase="defense" posConfig={p} slots={depthChart[p.id] ?? []} onConfigChange={val => onSlotsChange(p.id, val)} onDeletePosition={() => onDeletePosition('defense', p.id)} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                        ))}
                    </div>

                    <div className="roster-specialists">
                        <div style={{ display: 'flex', gap: 12 }}>
                            {SPECIALIST_IDS.map(id => (
                                <SpecialistCell key={id} id={id} slot={depthChart[id]?.[0] ?? null} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} showNeeds={showNeeds} />
                            ))}
                        </div>
                        <div style={{ flex: 1 }} />
                        {showNeeds && needs > 0 && <div className="roster-needs-label">REMAINING NEEDS: {needs}</div>}
                    </div>

                    {/* IR — bottom */}
                    <IRDropZone reserve={reserve} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
                </div>

                <RosterSidebar cuts={cuts} onSign={onSignClick} signLabel={signButtonLabel} masterPlayers={masterPlayers} draftedPlayers={draftedPlayers} />
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
