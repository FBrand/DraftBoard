import React, { useState } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';
import {
    listSeasons, currentSeason, viewedSeason, setViewedSeason,
    startSeason, scrapSeason, listBoards,
} from '../utils/boardRegistry';

/**
 * Seasons, and the two ways to move between them.
 *
 * They are a stack. One season is CURRENT and writable; every season under it
 * is archived and read-only, because a board is the record of where somebody
 * had a player at the time and history does not get edited. What stays
 * editable on an old board is the evaluation — what you know about a player
 * keeps growing after the board that ranked him is done.
 *
 * Two moves, and they are not symmetrical, which is why they do not look
 * alike here. Starting a season is additive and safe: nothing is lost, the
 * outgoing season freezes and stays. Rolling back DELETES the current season
 * and everything on it, which is the only destructive action in the app that
 * is not "start clean slate" — so it asks first, and it names exactly what
 * goes.
 */
export default function SeasonModal({ isOpen, onClose, onChanged }) {
    const [confirmingRollback, setConfirmingRollback] = useState(false);
    const [year, setYear] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEscapeKey(onClose, isOpen);
    if (!isOpen) return null;

    const seasons = listSeasons();
    const current = currentSeason();
    const viewing = viewedSeason();
    const previous = seasons.filter(s => s.id !== current?.id && s.status === 'archived')
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0] ?? null;

    // Reload rather than re-render. A season change swaps the roster, the
    // draft, free agency, the prospect pool and every board at once, and most
    // of those are held in memory — the draft class is read once at startup, the
    // repository keeps its own copy, free agency memoises its seeding. Asking
    // each of them to drop what it holds is a list that will be wrong the first
    // time somebody adds a stage. Clean slate already works this way.
    const done = () => { onChanged?.(); window.location.reload(); };

    const view = (season) => {
        setViewedSeason(season.id);
        done();
    };

    const create = async (e) => {
        e.preventDefault();
        if (busy) return;
        setError(null);
        setBusy(true);
        try {
            const made = await startSeason(Number(year));
            if (!made) {
                setError(seasons.some(s => s.year === Number(year))
                    ? `There is already a ${year} season.`
                    : 'Give a year, like 2027.');
                return;
            }
            done();
        } finally {
            setBusy(false);
        }
    };

    const rollBack = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const out = await scrapSeason();
            if (!out.ok) {
                setError(out.reason === 'nothing-underneath'
                    ? 'There is no earlier season to go back to.'
                    : 'Could not roll back.');
                return;
            }
            done();
        } finally {
            setBusy(false);
        }
    };

    const doomedBoards = current ? listBoards(current.id) : [];

    // The confirm block names both seasons, and it outlives the thing it is
    // asking about: scrapSeason() succeeds, the season underneath becomes
    // current, and React re-renders this modal once more before the reload
    // lands. On that render there is no season underneath any more, so
    // `previous` is null and the copy that reads "{previous.year} becomes
    // current again" threw. The work had already been done correctly — the
    // error was purely in describing it, after the fact.
    const confirming = confirmingRollback && !!previous && !!current;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content season-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Seasons</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>

                <div className="season-body">
                    {error && <div className="ap-error">{error}</div>}

                    <ul className="season-list">
                        {seasons.map(s => {
                            const isCurrent = s.id === current?.id;
                            const isViewing = s.id === viewing?.id;
                            return (
                                <li key={s.id} className={`season-row${isViewing ? ' viewing' : ''}`}>
                                    <button
                                        type="button"
                                        className="season-open"
                                        onClick={() => view(s)}
                                        disabled={isViewing}
                                        title={isCurrent
                                            ? 'The season you are working in'
                                            : 'Open this season — its boards are read-only'}
                                    >
                                        <span className="season-year">{s.year}</span>
                                        <span className={`season-tag ${isCurrent ? 'live' : 'archived'}`}>
                                            {isCurrent ? 'current' : 'read-only'}
                                        </span>
                                        <span className="season-boards">
                                            {listBoards(s.id).length} board{listBoards(s.id).length === 1 ? '' : 's'}
                                        </span>
                                        {isViewing && <span className="season-viewing">open</span>}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>

                    <form className="season-new" onSubmit={create}>
                        <label htmlFor="season-year">Start a new season</label>
                        <div className="season-new-row">
                            <input
                                id="season-year"
                                type="number"
                                min="2000"
                                max="2999"
                                className="text-input"
                                placeholder={current ? String(current.year + 1) : '2027'}
                                value={year}
                                onChange={e => setYear(e.target.value)}
                            />
                            <button type="submit" className="action-button primary" disabled={busy || !year}>
                                Roll over
                            </button>
                        </div>
                        <p className="season-note">
                            {current
                                ? `${current.year} freezes and stays. The new season starts with no boards — who is scouting this year is a decision, and last year's placements are about players who have left.`
                                : 'The first season.'}
                        </p>
                    </form>

                    <div className="season-danger">
                        {!confirming ? (
                            <>
                                <button
                                    type="button"
                                    className="action-button danger"
                                    disabled={!previous || busy}
                                    onClick={() => setConfirmingRollback(true)}
                                >Roll back to {previous ? previous.year : 'the previous season'}</button>
                                <p className="season-note">
                                    {previous
                                        ? `Deletes ${current.year} and everything on it.`
                                        : 'Nothing to go back to — this is the only season.'}
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="season-warning">
                                    This deletes the <strong>{current.year}</strong> season
                                    {doomedBoards.length > 0
                                        ? <> and its {doomedBoards.length} board{doomedBoards.length === 1 ? '' : 's'} — {doomedBoards.map(b => b.label).join(', ')} — with every placement on {doomedBoards.length === 1 ? 'it' : 'them'}.</>
                                        : <>, which has no boards on it yet.</>}
                                    {' '}{previous.year} becomes current again, exactly as you left it.
                                    Evaluations are kept — what you learned about a player does not stop
                                    being true because the board is gone.
                                    <br />This cannot be undone.
                                </p>
                                <div className="season-confirm-row">
                                    <button type="button" className="action-button secondary"
                                        onClick={() => setConfirmingRollback(false)}>Keep {current.year}</button>
                                    <button type="button" className="action-button danger" disabled={busy}
                                        onClick={rollBack}>Delete {current.year}</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
