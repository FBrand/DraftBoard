import React, { useState, useMemo, useRef, useEffect } from 'react';
import CenterBoard from './CenterBoard';
import ScoutingControls from './ScoutingControls';
import ScoutingLeftPanel from './ScoutingLeftPanel';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';
import useIsMobile from '../hooks/useIsMobile';
import Menu from './Menu';
import { rankBoard, moveToRank, between } from '../utils/boardRanking';
import useBoardRankings, { invalidatePools } from '../hooks/useBoardRankings';
import useUrlParam from '../hooks/useUrlParam';
import { PLAYER_TAGS } from '../utils/playerTags';
import AddProspectsModal from './AddProspectsModal';
import SettingsModal from './SettingsModal';
import { addProspect, savePlayerEdit, deletePlayer, restorePlayer, hiddenPlayers, toPoolPlayer, classify } from '../utils/prospects';
import * as athleticMatrix from '../utils/athleticMatrix';
import * as playerRegistry from '../utils/playerRegistry';

const { BOARDS, BOARD_LABELS } = scoutingState;

const TAG_FILTERS = [
    { id: 'all', label: 'All' },
    ...PLAYER_TAGS.map(t => ({ id: t.id, label: `${t.symbol} ${t.label}` })),
    { id: 'untagged', label: 'Untagged' },
];

// Uses the same board-grid CenterBoard renders for Draft — building a
// personal big board is structurally the same problem as building the
// consensus one. Every player is clickable/undimmed here regardless of
// live-draft .drafted status (alwaysClickable/hideDraftedStyle on
// CenterBoard/PlayerCard) — scouting happens independent of who's already
// off the board in the real draft.
//
// Scouting BUILDS boards, it doesn't compare one personal opinion against a
// fixed consensus — so evaluations are kept per board (Consensus/Dan/Ryan,
// same three identities the Draft/UDFA board-switcher uses), all loaded at
// once here so the info card's ‹/› arrows can page between an analyst's
// takes on the same player without losing the current selection. "My
// Board" (ScoutingLeftPanel) always reflects the currently active board's
// in-progress personal order.
export default function ScoutingView({ players, columnOrder }) {
    const [boards, setBoards] = useState(() => Object.fromEntries(BOARDS.map(b => [b, scoutingState.loadState(b)])));
    // Board and selected player live in the URL: "here's what Dan says about
    // this guy" is the thing you actually want to send someone.
    const [activeBoard, setActiveBoard] = useUrlParam('board', 'consensus', BOARDS);
    // Each analyst's own rankings file — switching board switches the actual
    // player pool, not just the overlay on top of one shared list.
    const { pools } = useBoardRankings(players);
    const boardPlayers = pools?.[activeBoard] ?? players;
    const [selectedNameParam, setSelectedNameParam] = useUrlParam('player', '');
    const selectedName = selectedNameParam || null;
    // replace, not push: flicking between players shouldn't fill the history
    // stack, but the address bar should still point at whoever is open.
    const setSelectedName = (name) => setSelectedNameParam(name ?? '', { replace: true });
    const [tagFilter, setTagFilter] = useState('all');
    const [unrankedOnly, setUnrankedOnly] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    // Removing a rankings-file player only HIDES him — the file still has him —
    // so there has to be a way back. Undo doesn't cover base data: it is shared
    // by every board, and rewinding one board's history must not silently
    // resurrect a player another analyst removed.
    const [hidden, setHidden] = useState(() => hiddenPlayers());
    // On mobile the three columns stack, so the info card would sit far below
    // the board — tapping a player looked like it did nothing. Present it as
    // a modal there instead. Still fully editable: this is Scouting.
    const isMobile = useIsMobile();

    // The boards are read once at mount, which is before the pools have
    // loaded — and loading them is what SEEDS a board from its rankings file.
    // Without re-reading, an edit would be computed against the empty
    // pre-seed state and saved over the seeded one.
    useEffect(() => {
        if (!pools) return;
        setBoards(Object.fromEntries(BOARDS.map(b => [b, scoutingState.loadState(b)])));
    }, [pools]);

    const state = boards[activeBoard];
    const entryIndex = useMemo(() => buildNameIndex(state.entries), [state.entries]);

    // Entries are joined to players by registry id. The name path below is a
    // fallback for entries written before ids existed and for players who have
    // left the pool — a name is not an identity on its own (two players can
    // share one), which is why the qualifier is passed when there is no id.
    const entryById = useMemo(
        () => new Map(state.entries.filter(e => e.playerId).map(e => [e.playerId, e])),
        [state.entries],
    );

    const entryFor = (name, qualifier) => {
        if (qualifier?.id) {
            const hit = entryById.get(qualifier.id);
            if (hit) return hit;
        }
        const idx = findMatchingIndex(name, entryIndex, qualifier);
        return idx !== -1 ? state.entries[idx] : null;
    };

    // Scouting's "Total Rank", "Position Rank" and "Round.Group" are not a
    // parallel set of fields — they ARE the board's own parameters, the ones
    // CenterBoard places cards by and the exported rankings CSV carries into
    // the draft board and roster import.
    //
    // Only the group and the within-tier order are stored. Total rank and
    // position rank are DERIVED from them (see boardRanking.js): subgroups
    // are authoritative, so 1.2 always outranks 1.3, and within a tier the
    // order is the analyst's explicit choice or, failing that, positional
    // value. That's why they can't drift apart or collide — there is one
    // ordering and both numbers are read off it.
    const effectivePlayers = useMemo(
        () => rankBoard(boardPlayers, entryFor),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [boardPlayers, entryIndex],
    );

    const visiblePlayers = useMemo(() => {
        return effectivePlayers.filter(p => {
            // Unranked means nobody has placed him in a tier yet — the state
            // every added player starts in, and the working list an analyst
            // needs after a weekend of games.
            if (unrankedOnly && p.round != null) return false;
            if (tagFilter === 'all') return true;
            const entry = entryFor(p.name, p);
            if (tagFilter === 'untagged') return !entry?.tag;
            return entry?.tag === tagFilter;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectivePlayers, tagFilter, unrankedOnly, entryIndex]);

    // Already ordered by effective rank above.
    const orderedPlayers = effectivePlayers;

    const selectedPlayer = selectedName ? effectivePlayers.find(p => p.name === selectedName) : null;

    // Writes ONE player's placement. Not an ordering of the board: nobody else
    // moves and nobody else is written.
    //
    // This used to stamp a fresh position onto all 328 entries for a single
    // drag, which was both a lot of writing and a quiet loss of information —
    // every untouched player ended up with an explicit order transcribed from
    // whatever the file happened to say. `withinGroup` being a float is what
    // makes one write enough: landing between two players is the midpoint of
    // their two values.
    const placeOne = (entries, player, placement) => {
        const out = [...entries];
        const now = new Date().toISOString();

        let idx = player.id ? out.findIndex(e => e.playerId === player.id) : -1;
        if (idx === -1) idx = findMatchingIndex(player.name, buildNameIndex(out), player);

        if (idx !== -1) {
            out[idx] = {
                ...out[idx],
                playerId: out[idx].playerId ?? player.id ?? null,
                ...placement,
                updatedAt: now,
            };
        } else {
            out.push({
                ...scoutingState.makeEntry(player.name, player.position, player.school ?? '', player.id ?? null),
                ...placement,
                updatedAt: now,
            });
        }
        return out;
    };

    // History is per board — undoing on Dan's board must not rewind Ryan's.
    // Bounded, since a scouting board's entries can run to the full pool.
    const past = useRef({});
    // Depth is tracked per board, not as one number: the Undo button reflects
    // whichever board is on screen, and switching to an untouched board must
    // show nothing to undo rather than the previous board's depth.
    const [undoDepths, setUndoDepths] = useState({});
    const canUndo = (undoDepths[activeBoard] ?? 0) > 0;

    const recordDepth = (board) => {
        setUndoDepths(prev => ({ ...prev, [board]: past.current[board]?.length ?? 0 }));
    };

    const commitBoard = (entries) => {
        // Spread the current state rather than rebuilding it: dropping the
        // `seeded` flag here un-seeded the board on every edit, so the next
        // load re-seeded it from the file and threw the edit away.
        const next = { ...boards[activeBoard], version: 1, entries };
        const stack = past.current[activeBoard] ?? (past.current[activeBoard] = []);
        stack.push(boards[activeBoard]);
        if (stack.length > 25) stack.shift();
        recordDepth(activeBoard);

        scoutingState.saveState(activeBoard, next);
        setBoards(prev => ({ ...prev, [activeBoard]: next }));
    };

    const undoBoard = () => {
        const stack = past.current[activeBoard];
        const previous = stack?.pop();
        if (!previous) return;
        recordDepth(activeBoard);
        scoutingState.saveState(activeBoard, previous);
        setBoards(prev => ({ ...prev, [activeBoard]: previous }));
    };

    const saveEntry = (updated) => {
        const current = effectivePlayers.find(p => p.name === updated.name);
        const wantedRank = updated.personalRank;
        const wantedRound = updated.round;

        const boardState = boards[activeBoard];
        let entries = [...boardState.entries];
        const idx = findMatchingIndex(updated.name, buildNameIndex(entries));
        // personalRank is derived, never stored — strip it before persisting
        // so a stale copy can't start competing with the derivation.
        const { personalRank: _drop, ...persisted } = updated;
        if (idx !== -1) entries[idx] = { ...entries[idx], ...persisted };
        else entries.push(persisted);

        // Typing a total rank is a MOVE, not an assignment: the player takes
        // that slot and adopts its tier. Nobody else shifts, because his
        // position is a value between his new neighbours rather than an index
        // that everything below has to make room for.
        if (wantedRank != null && current && wantedRank !== current.overallRank) {
            const moved = moveToRank(effectivePlayers, updated.name, wantedRank);
            if (moved) entries = placeOne(entries, current, moved);
        } else if (current && (updated.round !== current.round || updated.tier !== current.tier)) {
            // Changing the tier directly: he goes to the end of the new tier,
            // and the rest of the board is untouched.
            const last = [...effectivePlayers]
                .filter(p => p.round === wantedRound && p.tier === updated.tier)
                .pop() ?? null;
            entries = placeOne(entries, current, {
                round: wantedRound,
                tier: updated.tier,
                withinGroup: between(last, null, wantedRound, updated.tier),
            });
        }

        commitBoard(entries);
    };

    // Drag-and-drop reorder from ScoutingLeftPanel. Dropping a player among a
    // different tier's players moves them into that tier, same as typing the
    // rank would.
    const handleReorder = (newOrderedNames) => {
        // Exactly one player moved; find him and the two he landed between.
        const at = newOrderedNames.findIndex((n, i) => effectivePlayers[i]?.name !== n);
        if (at === -1) return;

        const byName = new Map(effectivePlayers.map(p => [p.name, p]));
        const moved = byName.get(newOrderedNames[at]);
        if (!moved) return;

        const before = byName.get(newOrderedNames[at - 1]) ?? null;
        const after = byName.get(newOrderedNames[at + 1]) ?? null;
        const host = before ?? after;
        if (!host) return;

        const round = host.round ?? null;
        const tier = host.tier ?? null;
        commitBoard(placeOne(boards[activeBoard].entries, moved, {
            round, tier, withinGroup: between(before, after, round, tier),
        }));
    };

    // Adding prospects. Base data (name/position/school) is shared by every
    // board — that a player exists is a fact — while the tier, tag, remarks
    // and matrix numbers entered alongside it are this analyst's opinion and
    // land on the active board only. The athletic matrix is the exception:
    // it measures the player, so it is global like the base data.
    //
    // Ranks are applied last, as moves against the ordering the earlier rows
    // produced, so a batch that ranks several players lands as one undo step
    // rather than one per player.
    const handleAddProspects = (rows) => {
        rows.forEach(r => addProspect({ name: r.name, position: r.position, school: r.school }));

        let entries = [...boards[activeBoard].entries];
        const index = buildNameIndex(entries);

        rows.forEach(r => {
            const round = r.round === '' ? null : parseInt(r.round, 10);
            const tier = r.tier === '' ? null : parseInt(r.tier, 10);
            const patch = {
                position: r.position, school: r.school, tag: r.tag, round, tier,
                strengths: r.strengths, weaknesses: r.weaknesses, notes: r.notes,
                updatedAt: new Date().toISOString(),
            };
            const idx = findMatchingIndex(r.name, index, r);
            if (idx !== -1) entries[idx] = { ...entries[idx], ...patch };
            else entries.push({ ...scoutingState.makeEntry(r.name, r.position, r.school), ...patch });

            if (r.matrixTotal !== '') athleticMatrix.setScore(r.name, 'total', r.matrixTotal);
            if (r.matrixPosition !== '') athleticMatrix.setScore(r.name, 'position', r.matrixPosition, r);
        });

        // The new players have to be in the pool before they can be ranked
        // within it, so the merged pool is rebuilt here rather than waiting
        // for the hook's own reload.
        const pool = [...boardPlayers, ...rows
            .filter(r => !boardPlayers.some(p => p.name === r.name))
            .map(r => toPoolPlayer(r))];

        const lookup = (list) => {
            const i = buildNameIndex(list);
            return (name) => {
                const at = findMatchingIndex(name, i);
                return at !== -1 ? list[at] : null;
            };
        };

        let ordering = rankBoard(pool, lookup(entries));
        rows.filter(r => r.rank !== '').forEach(r => {
            const moved = moveToRank(ordering, r.name, parseInt(r.rank, 10));
            if (!moved) return;
            entries = placeOne(entries, ordering.find(p => p.name === r.name) ?? r, moved);
            ordering = rankBoard(pool, lookup(entries));
        });

        commitBoard(entries);
        invalidatePools();
        setAddOpen(false);
    };

    // Correcting a player's base data. Name, position and school together are
    // the identity, so changing any of them is a migration: the board entries
    // and matrix scores are keyed by that identity and have to follow, or they
    // are orphaned on a player who no longer exists. Returns a message when the
    // change can't be made.
    const handlePlayerSave = ({ previous, name, position, school }) => {
        const changed = name !== previous.name || position !== previous.position
            || school !== (previous.school ?? '');
        if (!changed) return null;

        // Only a clash with an identical identity blocks — a namesake at
        // another position or school is a different man, not a duplicate.
        const others = boardPlayers.filter(p => p !== previous);
        const hit = classify(name, others, { position, school });
        if (hit.match) {
            return `${hit.match.name}${hit.match.position ? ` (${hit.match.position})` : ''} is already on the board.`;
        }

        savePlayerEdit(previous, { name, position, school });
        // The registry record keeps its id and gains the old identity as an
        // alias, so the rankings file — which still carries the old name on
        // every load — resolves back to this same player instead of creating
        // a second record for him.
        if (previous.id) playerRegistry.rename(previous.id, { name, position, school });
        if (name !== previous.name) athleticMatrix.renameScores(previous.name, name, previous);

        const next = {};
        BOARDS.forEach(b => {
            const board = scoutingState.loadState(b);
            const idx = findMatchingIndex(previous.name, buildNameIndex(board.entries), previous);
            if (idx !== -1) {
                const entries = board.entries.map((e, i) => (i === idx ? { ...e, name, position, school } : e));
                const updated = { ...board, entries };
                scoutingState.saveState(b, updated);
                next[b] = updated;
            } else {
                next[b] = board;
            }
        });
        setBoards(next);
        invalidatePools();
        if (name !== previous.name) setSelectedName(name);
        return null;
    };

    const handlePlayerDelete = (player) => {
        deletePlayer(player);
        setHidden(hiddenPlayers());
        invalidatePools();
        setSelectedName(null);
    };

    const handleRestoreAll = () => {
        hidden.forEach(restorePlayer);
        setHidden(hiddenPlayers());
        invalidatePools();
    };

    const cycleBoard = (dir) => {
        const idx = BOARDS.indexOf(activeBoard);
        setActiveBoard(BOARDS[(idx + dir + BOARDS.length) % BOARDS.length]);
    };

    const handleExport = () => {
        const csv = scoutingState.exportCSV(state);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scouting_${activeBoard}.csv`;
        a.click();
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const imported = scoutingState.parseCSV(text);
        scoutingState.saveState(activeBoard, imported);
        past.current[activeBoard] = []; recordDepth(activeBoard); // importing replaces the board
        setBoards(prev => ({ ...prev, [activeBoard]: imported }));
    };

    // group,name,position — ready to drop into public/ or load via
    // ?rankings=, unlike Export CSV above (which round-trips the full
    // overlay: tags/notes/matrix numbers/etc. for re-import into Scouting).
    const handleExportRankings = () => {
        const csv = scoutingState.exportRankingsCSV(effectivePlayers);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rankings_${activeBoard}_scouting.csv`;
        a.click();
    };

    return (
        <div className="roster-view">
            <div className="top-panel">
                <div className="roster-brand">
                    <span className="roster-brand-name">SCOUTING</span>
                    <span className="roster-brand-sub">BUILD YOUR BOARD</span>
                </div>

                <div style={{ width: '20px' }} />

                <div className="board-switcher">
                    <span className="switcher-label">BOARD</span>
                    <div className="switcher-buttons">
                        {BOARDS.map(b => (
                            <button
                                key={b}
                                className={`switcher-btn ${activeBoard === b ? 'active' : ''}`}
                                onClick={() => setActiveBoard(b)}
                            >{BOARD_LABELS[b]}</button>
                        ))}
                    </div>
                </div>

                <div className="roster-zoom-ctrl" style={{ gap: 6 }}>
                    {TAG_FILTERS.map(f => (
                        <button
                            key={f.id}
                            onClick={() => setTagFilter(f.id)}
                            className={`rv-ctrl-btn ${tagFilter === f.id ? 'active' : ''}`}
                            style={{ width: 'auto', padding: '2px 8px' }}
                        >{f.label}</button>
                    ))}
                    <span className="scouting-filter-divider" />
                    <button
                        onClick={() => setUnrankedOnly(v => !v)}
                        className={`rv-ctrl-btn ${unrankedOnly ? 'active' : ''}`}
                        style={{ width: 'auto', padding: '2px 8px' }}
                        title="Players not yet placed in a tier"
                    >Unranked</button>
                </div>

                <div style={{ flex: 1 }} />

                <div className="top-actions">
                    <button
                        onClick={() => setAddOpen(true)}
                        className="action-pill add-pill"
                        title="Add prospects missing from the rankings"
                    >+ Add Players</button>
                    <button
                        onClick={undoBoard}
                        disabled={!canUndo}
                        className="action-pill undo-pill"
                        title="Undo the last change on this board"
                    >Undo</button>
                    <Menu items={[
                        { label: 'Export as Board CSV…', onClick: handleExportRankings, title: 'group,name,position — ready for public/ or ?rankings=' },
                        { label: 'Export Scouting CSV…', onClick: handleExport, title: 'Full overlay: tags, notes, matrix numbers' },
                        { label: 'Import Scouting CSV…', file: { accept: '.csv', onFile: handleImport } },
                        { label: 'Add Prospects…', onClick: () => setAddOpen(true), title: 'Type or import players missing from the rankings' },
                        { label: 'Settings…', onClick: () => setSettingsOpen(true), title: 'Positional value and the Athletic Matrix link — shared by every board' },
                        ...(hidden.length ? [{
                            label: `Restore ${hidden.length} Removed Player${hidden.length === 1 ? '' : 's'}`,
                            onClick: handleRestoreAll,
                            title: 'Bring back players removed from every board',
                        }] : []),
                    ]} />
                </div>
            </div>

            <div className="scouting-layout">
                <ScoutingLeftPanel
                    orderedPlayers={orderedPlayers}
                    selectedName={selectedName}
                    onSelect={(p) => setSelectedName(p.name)}
                    onReorder={handleReorder}
                />

                <CenterBoard
                    players={visiblePlayers}
                    onAction={(p) => setSelectedName(p.name)}
                    columnOrder={columnOrder}
                    isFocusMode={true}
                    tagFor={(name, qualifier) => entryFor(name, qualifier)?.tag ?? null}
                    alwaysClickable={true}
                    hideDraftedStyle={true}
                />

                {!isMobile && (
                    <ScoutingControls
                        key={`${selectedName || 'none'}-${activeBoard}`}
                        player={selectedPlayer}
                        entry={selectedPlayer ? entryFor(selectedPlayer.name, selectedPlayer) : null}
                        onChange={saveEntry}
                        onClose={() => setSelectedName(null)}
                        boardLabel={selectedPlayer ? BOARD_LABELS[activeBoard] : null}
                        onPrevBoard={() => cycleBoard(-1)}
                        onNextBoard={() => cycleBoard(1)}
                        onPlayerSave={handlePlayerSave}
                        onPlayerDelete={handlePlayerDelete}
                    />
                )}
            </div>

            {settingsOpen && (
                <SettingsModal
                    isOpen
                    onClose={() => setSettingsOpen(false)}
                    // Positional value orders players nobody has placed, so a
                    // change has to re-rank the boards, not just the next one
                    // somebody opens.
                    onChanged={invalidatePools}
                />
            )}

            {addOpen && (
                <AddProspectsModal
                    isOpen
                    onClose={() => setAddOpen(false)}
                    existingPlayers={boardPlayers}
                    onSubmit={handleAddProspects}
                    onOpenPlayer={setSelectedName}
                />
            )}

            {isMobile && selectedPlayer && (
                <ScoutingControls
                    key={`${selectedName}-${activeBoard}-modal`}
                    variant="modal"
                    player={selectedPlayer}
                    entry={entryFor(selectedPlayer.name, selectedPlayer)}
                    onChange={saveEntry}
                    onClose={() => setSelectedName(null)}
                    boardLabel={BOARD_LABELS[activeBoard]}
                    onPrevBoard={() => cycleBoard(-1)}
                    onNextBoard={() => cycleBoard(1)}
                    onPlayerSave={handlePlayerSave}
                    onPlayerDelete={handlePlayerDelete}
                />
            )}
        </div>
    );
}
