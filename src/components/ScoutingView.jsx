import React, { useState, useMemo, useRef, useEffect } from 'react';
import ScoutingGroupedList, { UnmatchedList } from './ScoutingGroupedList';
import { GROUPINGS } from '../utils/grouping';
import ScoutingControls from './ScoutingControls';
import ScoutingLeftPanel from './ScoutingLeftPanel';
import BoardSwitcher from './BoardSwitcher';
import { parseRankings } from '../utils/dataParser';
import CreateBoardModal from './CreateBoardModal';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';
import useIsMobile from '../hooks/useIsMobile';
import Menu from './Menu';
import { exportBoardCSV } from '../utils/boardCsv';
import { rankBoard, moveToRank, between } from '../utils/boardRanking';
import useBoardRankings, { invalidatePools } from '../hooks/useBoardRankings';
import useUrlParam from '../hooks/useUrlParam';
import { PLAYER_TAGS } from '../utils/playerTags';
import AddProspectsModal from './AddProspectsModal';
import SettingsModal from './SettingsModal';
import { TextPromptDialog } from './Dialogs';
import { addProspect, savePlayerEdit, deletePlayer, restorePlayer, hiddenPlayers, toPoolPlayer, classify } from '../utils/prospects';
import * as athleticMatrix from '../utils/athleticMatrix';
import * as playerRegistry from '../utils/playerRegistry';

import { createBoard, listBoards, boardBySlug, boardById, renameBoard, listSeasons, currentSeason } from '../utils/boardRegistry';
import { ownerIdFor, remarksFor, addRemark, removeRemark } from '../utils/evaluations';

const TAG_FILTERS = [
    { id: 'all', label: 'All' },
    ...PLAYER_TAGS.map(t => ({ id: t.id, label: `${t.symbol} ${t.label}` })),
    { id: 'untagged', label: 'Untagged' },
    // Unranked is a filter like any other — "nobody has placed him" is a state
    // to filter on, not a second axis. It was a separate toggle that could be
    // combined with a tag, which sounds flexible and in practice just made two
    // controls that looked alike behave differently.
    { id: 'unranked', label: 'Unranked' },
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
export default function ScoutingView({ players }) {
    // Which boards exist comes from the registry and is only known once it has
    // loaded, which happens alongside the pools.
    const [boardList, setBoardList] = useState(() => listBoards());
    const [boards, setBoards] = useState({});
    // Board and selected player live in the URL: "here's what Dan says about
    // this guy" is the thing you actually want to send someone.
    // The URL carries the board's slug, not its id: a link should survive an
    // analyst being renamed, and an opaque id in an address bar helps nobody.
    const [boardSlug, setBoardSlug] = useUrlParam('board', 'consensus');
    const activeBoard = (boardBySlug(boardSlug) ?? boardList[0])?.id ?? null;
    const setActiveBoard = (id) => setBoardSlug(boardById(id)?.slug ?? '');
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
    const [addOpen, setAddOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [newBoardOpen, setNewBoardOpen] = useState(false);
    // An import that replaces a board should say what it did — silence here
    // reads as "nothing happened" when the file was wrong.
    const [importSummary, setImportSummary] = useState(null);
    const [renaming, setRenaming] = useState(null);
    // Removing a rankings-file player only HIDES him — the file still has him —
    // so there has to be a way back. Undo doesn't cover base data: it is shared
    // by every board, and rewinding one board's history must not silently
    // resurrect a player another analyst removed.
    const [hidden, setHidden] = useState(() => hiddenPlayers());
    // On mobile the three columns stack, so the info card would sit far below
    // the board — tapping a player looked like it did nothing. Present it as
    // a modal there instead. Still fully editable: this is Scouting.
    const isMobile = useIsMobile();
    // How the middle column is grouped. A view preference, not board data —
    // it changes how the same players are read, never where they sit.
    const [groupBy, setGroupBy] = useState('position');

    // The boards are read once at mount, which is before the pools have
    // loaded — and loading them is what SEEDS a board from its rankings file.
    // Without re-reading, an edit would be computed against the empty
    // pre-seed state and saved over the seeded one.
    useEffect(() => {
        if (!pools) return;
        const list = listBoards();
        setBoardList(list);
        setBoards(Object.fromEntries(list.map(b => [b.id, scoutingState.loadState(b.id)])));
    }, [pools]);

    const state = boards[activeBoard] ?? { version: 1, entries: [] };

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

    // Remarks belong to whoever wrote them, not to the board — so they survive
    // the board freezing, and one man's view of a player runs across every
    // season he watches him. See utils/evaluations.js.
    const [remarkTick, setRemarkTick] = useState(0);
    const seasons = listSeasons();
    const ownerId = ownerIdFor(boardById(activeBoard));
    const selectedRemarks = useMemo(
        () => (ownerId && selectedName ? remarksFor(ownerId, effectivePlayers.find(p => p.name === selectedName)?.id) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ownerId, selectedName, effectivePlayers, remarkTick],
    );

    const handleAddRemark = (kind, text) => {
        const id = effectivePlayers.find(p => p.name === selectedName)?.id;
        if (!ownerId || !id) return;
        // Stamped with the CURRENT season, not the board's: a note written
        // today is a note from today, even while an old board is on screen.
        addRemark(ownerId, id, kind, text, currentSeason()?.id ?? null);
        setRemarkTick(t => t + 1);
    };

    const handleRemoveRemark = (remarkId) => {
        const id = effectivePlayers.find(p => p.name === selectedName)?.id;
        if (!ownerId || !id) return;
        removeRemark(ownerId, id, remarkId);
        setRemarkTick(t => t + 1);
    };

    const visiblePlayers = useMemo(() => {
        return effectivePlayers.filter(p => {
            // Unranked means nobody has placed him in a tier yet — the state
            // every added player starts in, and the working list an analyst
            // needs after a weekend of games.
            if (tagFilter === 'unranked') return p.round == null;
            if (tagFilter === 'all') return true;
            const entry = entryFor(p.name, p);
            if (tagFilter === 'untagged') return !entry?.tag;
            return entry?.tag === tagFilter;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectivePlayers, tagFilter, entryIndex]);

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

    const handleReorder = (newOrderedNames) => {
        // Exactly one player moved; find HIM, and the two he landed between.
        //
        // Which end of the change he is at depends on the direction, and this
        // used to take the first difference either way. Moving a player UP
        // does make him the first difference. Moving him DOWN does not —
        // everyone he passed shifts up by one, so the first difference is the
        // player he displaced, and the placement got computed for that man
        // instead. It landed him exactly where he already was, so dragging a
        // player DOWN the ranking did nothing whatsoever.
        //
        // The moved player is at one end of the changed span: if the new
        // ordering's first changed name is the old ordering's last changed
        // name, he came up; otherwise he went down.
        const oldNames = effectivePlayers.map(p => p.name);
        let first = 0;
        while (first < oldNames.length && oldNames[first] === newOrderedNames[first]) first += 1;
        if (first === oldNames.length) return;   // nothing actually moved

        let last = oldNames.length - 1;
        while (last > first && oldNames[last] === newOrderedNames[last]) last -= 1;

        const movedName = newOrderedNames[first] === oldNames[last]
            ? newOrderedNames[first]
            : newOrderedNames[last];
        const at = newOrderedNames.indexOf(movedName);
        if (at === -1) return;

        const byName = new Map(effectivePlayers.map(p => [p.name, p]));
        const moved = byName.get(movedName);
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
        // A row marked as an update is about somebody already on the board;
        // adding him again would mint a second record for one man.
        rows.forEach(r => {
            if (!r.updateExisting) addProspect({ name: r.name, position: r.position, school: r.school });
        });

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
        //
        // Excluded by id, not by object identity: rankBoard returns fresh
        // objects, so `p !== previous` was true for the player himself and
        // every rename collided with the player being renamed.
        const others = boardPlayers.filter(p => (previous.id
            ? p.id !== previous.id
            : !(p.name === previous.name && p.position === previous.position)));
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
        boardList.forEach(({ id: b }) => {
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
        const ids = boardList.map(b => b.id);
        const idx = ids.indexOf(activeBoard);
        if (idx === -1) return;
        setActiveBoard(ids[(idx + dir + ids.length) % ids.length]);
    };

    /**
     * The spreadsheet format — round, tier, name, position, school, tag and
     * an evaluation cell holding the +/-/• remarks. Unlike "Export Scouting
     * CSV" this is meant to be READ and EDITED by a person in Google Sheets,
     * and unlike "Export as Board CSV" it carries the analyst's evaluations
     * rather than placement alone.
     */
    /**
     * Creates a board and, if a file was given, seeds it from that file.
     *
     * Seeding goes through the same parse the shipped rankings use, so a board
     * started from a CSV is indistinguishable from one that shipped with the
     * app — and an empty board is a real option: every player shows unranked
     * until somebody places him.
     */
    const handleCreateBoard = async ({ label, authorName, file }) => {
        const board = await createBoard({ label, authorName });
        if (!board) return;

        if (file) {
            const players = parseRankings(await file.text()).filter(p => p?.name);
            if (players.length) scoutingState.seedBoard(board.id, players);
        }

        // The pools are keyed by board, so a new one has to be re-merged
        // before it can be shown.
        invalidatePools();
        setBoardList(listBoards());
        setActiveBoard(board.id);
    };

    const handleExportSpreadsheet = () => {
        const csv = exportBoardCSV(effectivePlayers, {
            entryFor: (p) => entryFor(p.name, p),
            // Remarks belong to the author rather than the board, so they are
            // read from the owner — which for consensus is the board itself.
            remarksFor: (p) => (ownerId && p.id ? remarksFor(ownerId, p.id) : []),
            matrixFor: (p) => athleticMatrix.getScores(p.name, p),
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rankings_${activeBoard}.csv`;
        a.click();
    };

    return (
        <div className="roster-view">
            {importSummary && (
                <div className="import-summary" role="status">
                    <span>
                        Imported <strong>{importSummary.placed}</strong> players
                        {importSummary.created ? <> · <strong>{importSummary.created}</strong> new</> : null}
                        {importSummary.remarks ? <> · <strong>{importSummary.remarks}</strong> remarks</> : null}
                    </span>
                    <button type="button" className="close-button" onClick={() => setImportSummary(null)}>&times;</button>
                </div>
            )}

            <div className="top-panel">
                <div className="roster-brand">
                    <span className="roster-brand-name">SCOUTING</span>
                    <span className="roster-brand-sub">BUILD YOUR BOARD</span>
                </div>

                <div style={{ width: '20px' }} />

                <BoardSwitcher
                    boards={boardList}
                    activeId={activeBoard}
                    onSelect={(b) => setActiveBoard(b.id)}
                />

                <div className="roster-zoom-ctrl" style={{ gap: 6 }}>
                    {TAG_FILTERS.map(f => (
                        <button
                            key={f.id}
                            onClick={() => setTagFilter(f.id)}
                            className={`rv-ctrl-btn ${tagFilter === f.id ? 'active' : ''}`}
                            style={{ width: 'auto', padding: '2px 8px' }}
                        >{f.label}</button>
                    ))}
                </div>

                <div className="board-switcher">
                    <span className="switcher-label">GROUP BY</span>
                    <div className="switcher-buttons">
                        {GROUPINGS.map(g => (
                            <button
                                key={g.id}
                                onClick={() => setGroupBy(g.id)}
                                className={`switcher-btn ${groupBy === g.id ? 'active' : ''}`}
                                title={`Group the board by ${g.label.toLowerCase()}`}
                            >{g.label}</button>
                        ))}
                    </div>
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
                        { label: 'Export Board CSV…', onClick: handleExportSpreadsheet, title: 'The whole board — editable in Sheets, and readable as a seed file in public/ or ?rankings=' },
                        { label: 'New Board…', onClick: () => setNewBoardOpen(true), title: 'A board for another analyst — optionally seeded from a CSV' },
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
                {!isMobile && (
                <ScoutingLeftPanel
                    orderedPlayers={orderedPlayers}
                    selectedName={selectedName}
                    onSelect={(p) => setSelectedName(p.name)}
                    onReorder={handleReorder}
                />
                )}

                <ScoutingGroupedList
                    players={visiblePlayers}
                    groupBy={groupBy}
                    selectedName={selectedName}
                    onSelect={(p) => setSelectedName(p.name)}
                    tagFor={(name, qualifier) => entryFor(name, qualifier)?.tag ?? null}
                    // On a phone this is the only column, so the players the
                    // grouping cannot place go at the bottom of it.
                    unmatchedInline={isMobile}
                />

                {!isMobile && (
                    <UnmatchedList
                        players={visiblePlayers}
                        groupBy={groupBy}
                        selectedName={selectedName}
                        onSelect={(p) => setSelectedName(p.name)}
                        tagFor={(name, qualifier) => entryFor(name, qualifier)?.tag ?? null}
                    />
                )}

                {!isMobile && (
                    <ScoutingControls
                        key={`${selectedName || 'none'}-${activeBoard}`}
                        player={selectedPlayer}
                        entry={selectedPlayer ? entryFor(selectedPlayer.name, selectedPlayer) : null}
                        onChange={saveEntry}
                        onClose={() => setSelectedName(null)}
                        boardLabel={selectedPlayer ? boardById(activeBoard)?.label ?? '' : null}
                        onPrevBoard={() => cycleBoard(-1)}
                        onNextBoard={() => cycleBoard(1)}
                        remarks={selectedRemarks}
                        seasons={seasons}
                        onAddRemark={handleAddRemark}
                        onRemoveRemark={handleRemoveRemark}
                        remarks={selectedRemarks}
                    seasons={seasons}
                    onAddRemark={handleAddRemark}
                    onRemoveRemark={handleRemoveRemark}
                    onPlayerSave={handlePlayerSave}
                        onPlayerDelete={handlePlayerDelete}
                    />
                )}
            </div>

            {renaming && (
                <TextPromptDialog
                    title="Rename board"
                    submitLabel="Rename"
                    initialValue={boardById(renaming)?.label ?? ''}
                    onCancel={() => setRenaming(null)}
                    onSubmit={(label) => {
                        renameBoard(renaming, label);
                        setBoardList(listBoards());
                        setRenaming(null);
                    }}
                />
            )}

            <CreateBoardModal
                key={`new-board-${newBoardOpen}`}
                isOpen={newBoardOpen}
                onClose={() => setNewBoardOpen(false)}
                onCreate={handleCreateBoard}
            />

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
                    boardLabel={boardById(activeBoard)?.label ?? ''}
                    onPrevBoard={() => cycleBoard(-1)}
                    onNextBoard={() => cycleBoard(1)}
                    remarks={selectedRemarks}
                    seasons={seasons}
                    onAddRemark={handleAddRemark}
                    onRemoveRemark={handleRemoveRemark}
                    onPlayerSave={handlePlayerSave}
                    onPlayerDelete={handlePlayerDelete}
                />
            )}
        </div>
    );
}
