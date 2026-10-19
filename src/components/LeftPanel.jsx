import React, { useState, useRef, useEffect } from 'react';
import PlayerCard from './PlayerCard';

/**
 * How long a just-drafted player stays in this list before it closes over him.
 *
 * Long enough to outlast a double-click, short enough not to read as a list
 * that has not noticed. See `held` below.
 */
const HOLD_MS = 1200;

const LeftPanel = ({ players, onDraft, onInfoOpen, tagFor }) => {
    const [searchTerm, setSearchTerm] = useState('');

    // The men taken in the last moment, kept in place rather than removed.
    //
    // This list drops a player the instant he is drafted, so the card under the
    // cursor is replaced by whoever was below him — and the second click of an
    // accidental double takes THAT man. Measured: one double-click on Fernando
    // Mendoza drafted Mendoza at pick 1 and Arvell Reese at pick 2, and one
    // Undo took back only one of them. On air that is a pick nobody made,
    // announced.
    //
    // Three guards at the click were tried and measured and none can work: once
    // the list has re-flowed, nothing distinguishes the second half of a
    // double-click from a deliberate one — same position, new element, fresh
    // click. So the list holds still instead. The repeat click then lands on a
    // player who is already drafted, which `draftPlayer` has always refused.
    //
    // Focus mode never had this bug for exactly this reason: it leaves drafted
    // cards where they are rather than filtering them out.
    const [held, setHeld] = useState([]);
    const timers = useRef([]);
    useEffect(() => () => timers.current.forEach(clearTimeout), []);

    const draftAndHold = (player) => {
        const key = `${player.name}|${player.position ?? ''}`;
        setHeld(prev => (prev.includes(key) ? prev : [...prev, key]));
        timers.current.push(setTimeout(
            () => setHeld(prev => prev.filter(k => k !== key)),
            HOLD_MS,
        ));
        onDraft(player);
    };

    const isHeld = (p) => held.includes(`${p.name}|${p.position ?? ''}`);

    // While held, the card is inert. Without this the repeat click lands on a
    // player who is now drafted, and a drafted card answers the only question
    // left about him — who took him — by opening his card. Correct everywhere
    // else; during a live draft it is a modal nobody asked for, over the Undo
    // button, a third of a second after the pick.

    const remaining = players
        .filter(p => !p.drafted || isHeld(p))
        .filter(p => {
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            return p.name.toLowerCase().includes(term) || p.position.toLowerCase().includes(term);
        })
        // Unranked sorts LAST, not first. An unranked player has no rank at
        // all — rankBoard returns null rather than the worst number, because
        // numbering him last would assert a judgement nobody made — and
        // `null - 5` is -5, which puts him above the best prospect in the
        // class, in the list an analyst scans on air. Same rule, same
        // expression, as boardEntries.readEntries.
        .sort((a, b) => (a.overallRank ?? Number.MAX_SAFE_INTEGER) - (b.overallRank ?? Number.MAX_SAFE_INTEGER));

    const rounds = [1, 2, 3, 4, 5, 6, 7, 8];

    return (
        <div className="side-panel left-panel">
            <h3 className="panel-title text-center">Remaining</h3>

            <div className="search-bar">
                {/* A placeholder is not a label: it vanishes as soon as
                    anybody types, and a screen reader announces an edit box
                    with no name at all. */}
                <input
                    type="text"
                    aria-label="Search players by name or position"
                    placeholder="Search name or position..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                />
            </div>

            <div className="panel-content scroll-container">
                {searchTerm ? (
                    // Flat list view for search results
                    <div className="rankings-list">
                        {remaining.length > 0 ? (
                            remaining.map(player => (
                                <div key={player.name} onClick={() => { if (!isHeld(player)) draftAndHold(player); }} style={{ cursor: 'pointer' }}>
                                    <PlayerCard player={player} onInfoOpen={isHeld(player) ? undefined : onInfoOpen} tag={tagFor?.(player.name, player)} />
                                </div>
                            ))
                        ) : (
                            <div className="no-results">No players matching "{searchTerm}"</div>
                        )}
                    </div>
                ) : (
                    // Grouped by round view
                    rounds.map(round => {
                        // const roundPlayers = remaining.filter(p => getRound(p.overallRank) === round);
                        const roundPlayers = remaining.filter(p => p.round === round);
                        if (roundPlayers.length === 0) return null;

                        return (
                            <div key={round} style={{ marginBottom: '1.5rem' }}>
                                <div className="round-header">
                                    <span>ROUND {round}</span>
                                </div>
                                <div className="rankings-list">
                                    {roundPlayers.map(player => (
                                        <div key={player.name} onClick={() => { if (!isHeld(player)) draftAndHold(player); }} style={{ cursor: 'pointer' }}>
                                            <PlayerCard player={player} onInfoOpen={isHeld(player) ? undefined : onInfoOpen} tag={tagFor?.(player.name, player)} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default LeftPanel;
