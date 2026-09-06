import React, { useState } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';

import { getAthleticMatrixUrl } from '../utils/appLinks';
import { PLAYER_TAGS } from '../utils/playerTags';
import * as athleticMatrix from '../utils/athleticMatrix';
import { factsFor, setFacts, resolve as resolvePlayer, rename as renamePlayer, byId } from '../utils/playerRegistry';
import { savePlayerEdit } from '../utils/prospects';
import { REMARK_KINDS } from '../utils/evaluations';

// Shared with the board markers so a tag looks the same wherever it appears.
const TAGS = PLAYER_TAGS.map(t => ({ id: t.id, label: `${t.symbol} ${t.label}` }));

// derived: read off the board's ordering (boardRanking.js), not stored — so
// they're shown from the player, and Total Rank is the only one you can type
// into (typing it moves the player, which re-derives both).
const NUMBER_FIELDS = [
    { key: 'personalRank', label: 'Total Rank', derived: 'overallRank', editable: true },
    { key: 'positionRank', label: 'Position Rank', derived: 'positionRank' },
    { key: 'athleticMatrixTotal', label: 'Athletic Matrix (Total)', editable: true },
    { key: 'athleticMatrixPosition', label: 'Athletic Matrix (Pos)', editable: true },
];

// Facts, not opinions: true whoever is looking, so they sit on the player's
// record and read the same on every board. League entry settles once; team and
// previous team say where he is and where he came from.
const FACT_FIELDS = [
    { key: 'draftYear', label: 'Draft Year', type: 'number', placeholder: '????', min: 1936 },
    { key: 'draftRound', label: 'Round', type: 'number', placeholder: '???' },
    { key: 'draftPick', label: 'Pick', type: 'number', placeholder: '???' },
    { key: 'team', label: 'Team', type: 'text', placeholder: '???' },
    { key: 'previousTeam', label: 'Previous Team', type: 'text', placeholder: '???' },
];

const LIST_FIELDS = [
    { kind: 'strength', label: 'Strengths', symbol: '+', cls: 'strength' },
    { kind: 'weakness', label: 'Weaknesses', symbol: '−', cls: 'weakness' },
    { kind: 'note', label: 'Notes', symbol: '•', cls: 'note' },
];

const KIND_META = Object.fromEntries(LIST_FIELDS.map(f => [f.kind, f]));

/**
 * Groups remarks by the season they were written in, newest first.
 *
 * Undated remarks — anything written before remarks carried a season — go last
 * under no heading, because guessing a season for them would be inventing a
 * record rather than showing one.
 */
function bySeason(remarks, seasons) {
    const order = new Map(seasons.map((s, i) => [s.id, i]));
    const groups = new Map();
    (remarks ?? []).forEach(r => {
        const key = r.seasonId ?? '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    });
    return [...groups.entries()]
        .sort(([a], [b]) => {
            if (!a) return 1;
            if (!b) return -1;
            return (order.get(a) ?? 99) - (order.get(b) ?? 99);
        })
        .map(([seasonId, items]) => ({
            seasonId,
            label: seasons.find(x => x.id === seasonId)?.year ?? null,
            items,
        }));
}

// Read-only cards show every voice's remarks at once, headed by whose they
// are rather than by field name — what matters when you glance at a player
// mid-draft is who said it, and the +/−/• symbol already says which kind of
// remark it is. Each carries the season it was written in, so a remark from
// two years ago cannot be mistaken for a current read. Voices with nothing to
// say are omitted entirely.
function BoardNotes({ boards, seasons }) {
    const withContent = (boards ?? []).filter(b => b.remarks?.length);
    if (!withContent.length) return null;

    return (
        <div className="scouting-board-notes">
            {withContent.map(b => (
                <div key={b.board} className="scouting-board-notes-group">
                    <div className="scouting-board-notes-header">{b.label}</div>
                    {bySeason(b.remarks, seasons).map(group => (
                        <div key={group.seasonId || 'undated'} className="scouting-season-group">
                            {group.label && <div className="scouting-season-label">{group.label}</div>}
                            <ul className="scouting-bullet-list">
                                {group.items.map(r => {
                                    const meta = KIND_META[r.kind] ?? KIND_META.note;
                                    return (
                                        <li key={r.id} className={`scouting-remark ${meta.cls}`}>
                                            <span className="scouting-remark-symbol" aria-label={meta.label}>{meta.symbol}</span>
                                            <span>{r.text}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

/**
 * One kind of remark — strengths, weaknesses or notes — as a running log
 * rather than a list.
 *
 * Remarks accumulate across seasons and are grouped by the one they were
 * written in. Adding always stamps the CURRENT season, even while an old
 * board is on screen: a note written today is a note from today.
 */
function RemarkList({ label, symbol, cls, kind, remarks, seasons, onAdd, onRemove, readOnly }) {
    const [draft, setDraft] = useState('');
    const mine = (remarks ?? []).filter(r => r.kind === kind);

    const add = () => {
        const v = draft.trim();
        if (!v) return;
        onAdd(kind, v);
        setDraft('');
    };

    if (readOnly && !mine.length) return null;

    return (
        <div className={`scouting-list-field ${cls ?? ''}`}>
            <div className="scouting-list-label">{label}</div>
            {bySeason(mine, seasons).map(group => (
                <div key={group.seasonId || 'undated'} className="scouting-season-group">
                    {group.label && <div className="scouting-season-label">{group.label}</div>}
                    <ul className="scouting-bullet-list">
                        {group.items.map(r => (
                            <li key={r.id}>
                                <span className="scouting-remark-symbol" aria-hidden="true">{symbol}</span>
                                <span className="scouting-remark-text">{r.text}</span>
                                {!readOnly && (
                                    <button type="button" onClick={() => onRemove(r.id)}
                                        aria-label={`Remove ${label.toLowerCase()} item`}>&times;</button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
            {!readOnly && (
                <div className="scouting-list-add">
                    <input
                        type="text"
                        value={draft}
                        placeholder={`Add ${label.toLowerCase()}...`}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                    />
                    <button type="button" onClick={add}>+</button>
                </div>
            )}
        </div>
    );
}

// Player info/scouting panel. Two presentations of the same fields:
// variant="panel" (default) is Scouting's own persistent right-side column
// (matches Draft's LeftPanel/RightPanel convention) rather than the floating
// fixed-position overlay this used to be, which read as randomly parked in a
// corner regardless of what else was on screen. variant="modal" is the same
// content as a centered dialog — used outside Scouting (Draft/UDFA) where a
// right-click or long-press on any card opens this without a dedicated
// column to put it in; see PlayerInfoModal.jsx.
//
// Local numeric-input state intentionally resets when the selected player
// changes — the caller renders this with `key={player.name}` so React
// remounts it on selection change rather than syncing state via an effect
// (see https://react.dev/learn/you-might-not-need-an-effect).
export default function ScoutingControls({ player, entry, onChange, onClose, boardLabel, onPrevBoard, onNextBoard, variant = 'panel', readOnly = false, allBoardNotes, onPlayerSave, onPlayerDelete, onEntryChange, remarks = [], seasons = [], onAddRemark, onRemoveRemark }) {
    // Total Rank, Position Rank and Round.Group are the board's own
    // parameters, so they show the player's current values rather than blank
    // boxes — you're adjusting the real thing, not a field that merely sits
    // beside it. Rank and position rank are derived from the board's ordering
    // (boardRanking.js); typing a total rank moves the player, which
    // re-derives both. The athletic-matrix numbers have no source and stay
    // empty until filled in.
    // The matrix is a measurement of the player, so it lives in one shared
    // store rather than being copied onto each analyst's board.
    // Held in state, not read fresh each render: writing a score updates the
    // shared store, and the card has to re-render off that new value — the
    // Athletic Matrix credit line keys off it, and previously only appeared
    // after a remount.
    const [matrix, setMatrix] = useState(() => athleticMatrix.getScores(player?.name, player));
    const [numbers, setNumbers] = useState({
        personalRank: player?.overallRank ?? '',
        positionRank: player?.positionRank ?? '',
        athleticMatrixTotal: matrix.total ?? '',
        athleticMatrixPosition: matrix.position ?? '',
    });
    // Round and tier are two separate inputs; the board stores them joined as
    // 1.3, which is the form rankings.csv uses.
    const [roundVal, setRoundVal] = useState(entry?.round ?? player?.round ?? '');
    const [tierVal, setTierVal] = useState(entry?.tier ?? player?.tier ?? '');
    // Base data for a player added in-app — correctable and removable, since a
    // name taken down live on air is often a guess, and a typo would otherwise
    // be permanent. Rankings-file players have no such controls: their base
    // data comes from the file, and this app is not that file's editor.
    const [editingBase, setEditingBase] = useState(false);
    const [base, setBase] = useState({ name: player?.name ?? '', position: '', school: '' });
    const [baseError, setBaseError] = useState('');
    const [confirmRemove, setConfirmRemove] = useState(false);
    // The card opened outside Scouting shows one analyst's take at a time and
    // starts locked. A pencil beside the pager unlocks THAT board's opinions,
    // so a correction can be made where the player is being looked at rather
    // than only where boards are built.
    const [editingOpinions, setEditingOpinions] = useState(false);
    // Which half of the card is editable depends on where it was opened.
    //
    // Scouting edits OPINIONS — tier, tag, remarks — and doesn't show facts at
    // all: a prospect has not entered the league, so a draft year or a team
    // means nothing while a board is being built.
    //
    // The card opened from Roster or Free Agency is the other way round. There
    // a player is somebody's actual player, so his facts are what you want to
    // correct, and the opinions are three analysts' and not yours to edit from
    // here.
    //
    // A roster slot carries a name, not an id, so it is resolved — without
    // creating anything, because opening a card must not invent a player.
    const playerId = player?.id
        ?? (player?.name ? resolvePlayer({ name: player.name, position: player.position }, { create: false }) : null);
    const [facts, setFactsState] = useState(() => factsFor(playerId));

    // A roster slot knows a name and not much else — no school, and a position
    // that is the depth-chart row rather than the player's own. The record
    // fills in what the caller couldn't say.
    const record = playerId ? byId(playerId) : null;
    const shownPosition = player?.position || record?.position || '';
    const shownSchool = player?.school || record?.school || '';

    const commitFact = (key, raw) => {
        if (!playerId) return;
        setFacts(playerId, { [key]: raw });
        setFactsState(factsFor(playerId));
    };
    // Only the modal presentation is dismissable — the panel variant is a
    // permanent column, not something Escape should blank out.
    useEscapeKey(onClose, variant === 'modal' && !!player);

    if (!player) {
        if (variant === 'modal') return null;
        return (
            <div className="side-panel right-panel">
                <h3 className="panel-title">Player Info</h3>
                <div className="scouting-empty">Select a player to view or edit scouting notes.</div>
            </div>
        );
    }

    // Round and tier are two stored numbers. rankings.csv fuses them into one
    // "1.3" column, but that form now lives only at the CSV boundary.
    // Matrix numbers are facts and go on the player's record; everything else
    // on this card belongs to the board being edited.
    const commitNumber = (field, raw) => {
        const value = raw === '' ? null : parseInt(raw, 10);
        if (field.key === 'athleticMatrixTotal') {
            athleticMatrix.setScore(player.name, 'total', value, player);
            setMatrix(m => ({ ...m, total: value }));
        } else if (field.key === 'athleticMatrixPosition') {
            athleticMatrix.setScore(player.name, 'position', value, player);
            setMatrix(m => ({ ...m, position: value }));
        } else {
            commit({ [field.key]: value });
        }
    };

    // Every player is editable, not only the ones added in the app — a name
    // misspelt in a rankings file is just as wrong as one misheard on air, and
    // the analyst shouldn't have to know where a player came from to fix him.
    // The pencil unlocks whichever half of the card this view owns: opinions
    // in Scouting, facts in Roster and Free Agency. Both start read-only —
    // these cards are looked at far more often than they are corrected, and a
    // grid of live inputs invites a stray keystroke during a broadcast.
    const canEditBase = readOnly ? !!playerId : !!onPlayerSave;
    const factsLocked = readOnly && !editingBase;
    // Scouting is always live; elsewhere the pencil decides.
    const opinionsLive = !readOnly || (editingOpinions && !!onEntryChange);
    const canEditOpinions = readOnly && !!onEntryChange;

    // The name is the identity key everywhere in this app, so a rename is a
    // migration, not a field write — the caller moves the board entries and
    // matrix scores across and reports back anything that blocks it.
    const saveBase = () => {
        const name = base.name.trim();
        if (!name) return setBaseError('A player needs a name.');
        const patch = {
            name,
            position: base.position.trim().toUpperCase(),
            school: base.school.trim(),
        };

        if (onPlayerSave) {
            const error = onPlayerSave({ previous: player, ...patch });
            if (error) return setBaseError(error);
        } else {
            // Outside Scouting there is no board to migrate: entries are keyed
            // by the registry id, which a rename does not change, so they
            // follow on their own.
            savePlayerEdit(player, patch);
            if (playerId) renamePlayer(playerId, patch);
        }
        setBaseError('');
        setEditingBase(false);
    };

    // Facts hang off the player's record, so they are written once and read
    // the same on every board — unlike a tier or a tag, which belong to the
    // analyst who set them.
    const commitGroup = (r, t) => {
        const round = String(r ?? '').trim();
        const tier = String(t ?? '').trim();
        if (!round) return commit({ round: null, tier: null });
        commit({ round: parseInt(round, 10), tier: tier ? parseInt(tier, 10) : null });
    };

    // Scouting hands this to its own saveEntry, which can also move a player
    // by rank. The card opened elsewhere writes straight to the board it is
    // paged to — no rank moves there, because a rank is a position in an
    // ordering and the card is only showing one player.
    const commit = (patch) => {
        (onEntryChange ?? onChange)({
            name: player.name,
            position: player.position,
            tag: entry?.tag ?? null,
            round: entry?.round ?? null,
            tier: entry?.tier ?? null,
            withinGroup: entry?.withinGroup ?? null,
            athleticMatrixTotal: entry?.athleticMatrixTotal ?? null,
            athleticMatrixPosition: entry?.athleticMatrixPosition ?? null,
            strengths: entry?.strengths ?? [],
            weaknesses: entry?.weaknesses ?? [],
            notes: entry?.notes ?? [],
            ...patch,
            updatedAt: new Date().toISOString(),
        });
    };

    // Credit line for the Athletic Matrix, shown once a player actually has
    // matrix numbers on them — attribution where the data is displayed,
    // rather than an advert on every card.
    const hasMatrixValues = matrix.total != null || matrix.position != null;

    // Read-only cards show only what's actually filled in, so an untouched
    // player would otherwise render as an empty box with no explanation.
    // Only counts things an analyst actually entered. Total and position rank
    // are excluded on purpose: they're derived, so every player on a board has
    // them and they say nothing about whether anyone has looked at this player.
    // Read-only cards pull remarks from every board, so "nothing here yet"
    // has to account for all of them, not just the one being paged to.
    const anyBoardHasNotes = (allBoardNotes ?? []).some(b => b.remarks?.length);

    const hasAnyContent = !!(
        anyBoardHasNotes || (entry && (
            entry.tag ||
            entry.athleticMatrixTotal != null ||
            entry.athleticMatrixPosition != null ||
            remarks.length
        ))
    );

    const content = (
        <div className={variant === 'modal' ? 'side-panel right-panel scouting-modal-box' : 'side-panel right-panel'}>
            <div className="scouting-controls-header">
                {editingBase ? (
                    <div className="scouting-base-edit">
                        <input className="text-input" value={base.name} autoFocus
                            aria-label="Name"
                            onChange={e => setBase(b => ({ ...b, name: e.target.value }))} />
                        <input className="text-input" value={base.position}
                            aria-label="Position"
                            onChange={e => setBase(b => ({ ...b, position: e.target.value }))} />
                        <input className="text-input" value={base.school}
                            aria-label="School"
                            onChange={e => setBase(b => ({ ...b, school: e.target.value }))} />
                        <button type="button" className="ap-link" onClick={saveBase}>Save</button>
                        <button type="button" className="ap-link" onClick={() => {
                            setBase({ name: player.name, position: shownPosition, school: shownSchool });
                            setBaseError('');
                            setEditingBase(false);
                        }}>Cancel</button>
                    </div>
                ) : (
                    // Name on its own line, the rest of the identity under it.
                    // Strung out on one row it read as a run-on: a name, a
                    // dash, a position, a school and a pencil all competing.
                    <div className="scouting-controls-identity">
                        <strong className="scouting-controls-name">{player.name}</strong>
                        <div className="scouting-controls-meta">
                            {shownPosition && <span className="scouting-controls-pos">{shownPosition}</span>}
                            {shownSchool && <span className="scouting-controls-school">{shownSchool}</span>}
                        </div>
                    </div>
                )}
                <div className="scouting-header-actions">
                    {canEditBase && !editingBase && (
                        <button type="button" className="scouting-edit-btn"
                            title={readOnly ? 'Edit this player\u2019s details' : 'Edit name, position and school'}
                            aria-label="Edit name, position and school"
                            onClick={() => {
                                setBase({ name: player.name, position: shownPosition, school: shownSchool });
                                setEditingBase(true);
                            }}>✎</button>
                    )}
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>
            </div>
            {baseError && <div className="scouting-base-error">{baseError}</div>}

            {boardLabel && (
                <div className="scouting-board-pager">
                    <button type="button" onClick={onPrevBoard} aria-label="Previous board">‹</button>
                    <span>{boardLabel}'s Evaluation</span>
                    <button type="button" onClick={onNextBoard} aria-label="Next board">›</button>
                </div>
            )}

            <div className="panel-content scroll-container">
                {canEditOpinions && (
                    <div className="scouting-opinion-toolbar">
                        <span className="scouting-prospect-note">
                            {boardLabel ? `${boardLabel}'s take` : 'Evaluation'}
                        </span>
                        <button
                            type="button"
                            className={`scouting-edit-btn ${editingOpinions ? 'active' : ''}`}
                            title={editingOpinions ? 'Done editing this take' : 'Edit this take'}
                            aria-label="Edit this take"
                            onClick={() => setEditingOpinions(v => !v)}
                        >{editingOpinions ? '✓' : '✎'}</button>
                    </div>
                )}

                {!opinionsLive ? (
                    entry?.tag && (
                        <div className="scouting-controls-tags">
                            <span className="scouting-tag-btn active scouting-tag-static">
                                {TAGS.find(t => t.id === entry.tag)?.label ?? entry.tag}
                            </span>
                        </div>
                    )
                ) : (
                    <div className="scouting-controls-tags">
                        {TAGS.map(t => (
                            <button
                                key={t.id}
                                className={`scouting-tag-btn ${entry?.tag === t.id ? 'active' : ''}`}
                                onClick={() => commit({ tag: entry?.tag === t.id ? null : t.id })}
                            >{t.label}</button>
                        ))}
                    </div>
                )}

                {!opinionsLive ? (
                    // Round.Group is omitted when locked — it's a
                    // board-building control, not a read-out. The four numbers
                    // always show, falling back to "?" so an unevaluated
                    // player reads as "not rated yet" rather than silently
                    // dropping the field.
                    <div className="scouting-readonly-grid">
                        {NUMBER_FIELDS.map(f => {
                            // Total and position rank are derived from the
                            // board's ordering, so a player nobody has tiered
                            // has neither — they read as unknown rather than
                            // as the worst rank on the board.
                            const val = f.derived
                                ? player[f.derived]
                                : f.key === 'athleticMatrixTotal' ? matrix.total
                                : f.key === 'athleticMatrixPosition' ? matrix.position
                                : entry?.[f.key];
                            const isSet = val != null && val !== '' && val !== '-';
                            return (
                                <div key={f.key} className="scouting-readonly-field">
                                    <span className="scouting-readonly-label">{f.label}</span>
                                    <span className={`scouting-readonly-value${isSet ? '' : ' unset'}`}>
                                        {isSet ? val : '???'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <>
                        <div className="scouting-group-fields">
                            <label className="scouting-group-field">
                                Round
                                <input
                                    type="number"
                                    min="1"
                                    value={roundVal}
                                    placeholder="???"
                                    onChange={e => setRoundVal(e.target.value)}
                                    onBlur={() => commitGroup(roundVal, tierVal)}
                                />
                            </label>
                            <label className="scouting-group-field">
                                Tier
                                <input
                                    type="number"
                                    min="1"
                                    value={tierVal}
                                    placeholder="???"
                                    onChange={e => setTierVal(e.target.value)}
                                    onBlur={() => commitGroup(roundVal, tierVal)}
                                />
                            </label>
                        </div>

                        <div className="scouting-number-grid">
                            {NUMBER_FIELDS.map(f => (
                                <label key={f.key}>
                                    {f.label}
                                    {f.editable ? (
                                        <input
                                            type="number"
                                            min="1"
                                            value={numbers[f.key]}
                                            placeholder={f.derived ? '???' : ''}
                                            onChange={e => setNumbers(n => ({ ...n, [f.key]: e.target.value }))}
                                            onBlur={() => commitNumber(f, numbers[f.key])}
                                        />
                                    ) : (
                                        // Position rank is purely derived from the
                                        // board's ordering — there's nothing to type.
                                        <span className="scouting-derived-value" title="Derived from this board's order">
                                            {player[f.derived] ?? '???'}
                                        </span>
                                    )}
                                </label>
                            ))}
                        </div>
                    </>
                )}

                {hasMatrixValues && (
                    <a
                        className="scouting-matrix-credit"
                        href={getAthleticMatrixUrl()}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Get your Athletic Matrix copy here.
                    </a>
                )}

                {readOnly && playerId && (
                    <div className="scouting-fact-grid">
                        <div className="scouting-fact-header">
                            Facts
                            {factsLocked ? (
                                facts.isUdfa === true && <span className="scouting-fact-badge">Undrafted</span>
                            ) : (
                                <label className="scouting-udfa-toggle">
                                    <input
                                        type="checkbox"
                                        checked={facts.isUdfa === true}
                                        onChange={e => commitFact('isUdfa', e.target.checked || null)}
                                    />
                                    Undrafted
                                </label>
                            )}
                        </div>
                        {FACT_FIELDS.map(f => {
                            // An undrafted player has a year but no round and
                            // no pick — nothing to type, so nothing to show.
                            if (facts.isUdfa === true && (f.key === 'draftRound' || f.key === 'draftPick')) return null;
                            const value = facts[f.key];
                            return (
                                <label key={f.key} className="scouting-fact-field">
                                    <span>{f.label}</span>
                                    {factsLocked ? (
                                        <span className={`scouting-fact-value${value == null || value === '' ? ' unset' : ''}`}>
                                            {value == null || value === '' ? f.placeholder : value}
                                        </span>
                                    ) : (
                                        <input
                                            type={f.type}
                                            min={f.type === 'number' ? f.min ?? 1 : undefined}
                                            value={value ?? ''}
                                            placeholder={f.placeholder}
                                            onChange={e => setFactsState(v => ({ ...v, [f.key]: e.target.value }))}
                                            onBlur={e => commitFact(f.key, e.target.value)}
                                        />
                                    )}
                                </label>
                            );
                        })}
                    </div>
                )}

                {!opinionsLive ? <BoardNotes boards={allBoardNotes} seasons={seasons} /> : LIST_FIELDS.map(f => (
                    <RemarkList
                        key={f.kind}
                        kind={f.kind}
                        label={f.label}
                        symbol={f.symbol}
                        cls={f.cls}
                        remarks={remarks}
                        seasons={seasons}
                        onAdd={onAddRemark}
                        onRemove={onRemoveRemark}
                        readOnly={!onAddRemark}
                    />
                ))}

                {canEditBase && (
                    <div className="scouting-prospect-admin">
                        {confirmRemove ? (
                            <>
                                <span className="scouting-prospect-note">Remove from every board?</span>
                                <div className="scouting-prospect-confirm">
                                    <button type="button" className="ap-link" onClick={() => setConfirmRemove(false)}>Keep</button>
                                    <button type="button" className="scouting-prospect-remove"
                                        onClick={() => onPlayerDelete?.(player)}>Remove</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <span className="scouting-prospect-note">Base data</span>
                                <button type="button" className="scouting-prospect-remove"
                                    onClick={() => setConfirmRemove(true)}>Remove player</button>
                            </>
                        )}
                    </div>
                )}

                {readOnly && !hasAnyContent && (
                    <div className="scouting-empty">
                        Not scouted yet — add notes in the Scouting tab.
                    </div>
                )}
            </div>
        </div>
    );

    if (variant === 'modal') {
        return (
            <div className="modal-overlay" onClick={onClose}>
                <div onClick={e => e.stopPropagation()}>{content}</div>
            </div>
        );
    }
    return content;
}
