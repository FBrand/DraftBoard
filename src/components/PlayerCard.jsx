import React, { useRef } from 'react';
import { parseName } from '../utils/formatName';
import { tagById } from '../utils/playerTags';

const isIntString = (val) => /^\d+$/.test(val);
const LONG_PRESS_MS = 500;

const PlayerCard = ({ player, isBest, onClick, slim, team, displayPick, noStrikethrough, isCurrent, traded, tradeNote, alwaysClickable, hideDraftedStyle, onInfoOpen, tag }) => {
    const { name, position, overallRank, drafted, draftedByUs, team: draftedTeam } = player;

    // Secondary-click (desktop) / long-press (touch) opens the scouting info
    // card without disturbing the card's primary action (draft/sign/select).
    // suppressClickRef blocks the synthetic click a touchend fires right
    // after a long-press resolves — without it, a long-press would also
    // trigger onClick's draft/sign action immediately after opening the info
    // card.
    const pressTimer = useRef(null);
    const suppressClickRef = useRef(false);

    const clearPressTimer = () => {
        if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    };
    const handleContextMenu = (e) => {
        if (!onInfoOpen) return;
        e.preventDefault();
        onInfoOpen(player);
    };
    const handleTouchStart = () => {
        if (!onInfoOpen) return;
        clearPressTimer();
        pressTimer.current = setTimeout(() => {
            suppressClickRef.current = true;
            onInfoOpen(player);
        }, LONG_PRESS_MS);
    };
    const handleTouchEnd = () => clearPressTimer();
    const handleTouchMove = () => clearPressTimer();
    const handleClick = () => {
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        if ((alwaysClickable || !drafted) && onClick) onClick(player);
    };

    const classes = [
        'player-card',
        'anim-fade-in',
        drafted && !hideDraftedStyle ? 'drafted' : 'available',
        draftedByUs || (team === 'KC') || (draftedTeam === 'KC') ? 'ours' : '',
        isBest ? 'best' : '',
        slim ? 'slim' : '',
        noStrikethrough ? 'no-strike' : '',
        isCurrent ? 'current' : ''
    ].join(' ');

    const pickNo = displayPick || player.pickNumber;
    const teamAbbr = team || draftedTeam || (draftedByUs ? 'KC' : null);
    const rankDisplay = overallRank && overallRank !== '-' ? `#${overallRank}` : '';

    let displayTradeNote = '';
    if (traded && tradeNote) {
        // Handle "Compensatory Pick (From TEAM)" to just "TEAM", and strip leading "From "
        let cleanedNote = tradeNote
            .replace(/Compensatory Pick \(From\s+([^)]+)\)/i, '$1')
            .replace(/^From\s+/i, '');

        let isCommaCase = false;
        if (/via/i.test(cleanedNote)) {
            cleanedNote = cleanedNote.replace(/\s+and\s+/ig, ', ');
            isCommaCase = true;
        } else {
            cleanedNote = cleanedNote.replace(/\s+and\s+/ig, ' via ');
        }

        const maxLen = isCommaCase ? 16 : 14;
        if (cleanedNote.length > maxLen) {
            cleanedNote = '.. ' + cleanedNote.slice(-(maxLen - 3));
        }
        displayTradeNote = cleanedNote;
    }

    return (
        <div
            className={classes}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
        >
            <div className="card-top">
                <span className="player-rank">{rankDisplay}</span>
                <div className="card-team-info">
                    {traded && tradeNote && (
                        <span className="card-trade-note" style={{ fontSize: '0.62rem', color: 'var(--text-dim)', marginRight: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            {displayTradeNote}
                            <span style={{ color: '#FFB612', fontWeight: 900, fontSize: '1.2rem', lineHeight: 0.8 }}>⇄</span>
                        </span>
                    )}
                    {pickNo && <span className="card-pick-num">{isIntString(pickNo) ? 'PK ' : ''}{pickNo}</span>}
                    {slim && !pickNo && <div className="player-pos">{position.split('.')[1]}</div>}
                    {teamAbbr && <span className="card-team">{teamAbbr}</span>}
                </div>
            </div>
            <div className="card-bottom">
                <div className="player-name" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', overflow: 'hidden' }}>
                    <span style={{ color: parseName(name).nameColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {parseName(name).displayName}
                    </span>
                    {parseName(name).suffix && (
                        <span style={{ fontSize: '0.65rem', color: '#ff0000', fontWeight: 800, marginLeft: 4 }}>
                            {parseName(name).suffix}
                        </span>
                    )}
                </div>
                {!slim && <div className="player-pos">{position}</div>}
            </div>
            {(() => {
                // The rankings-file "*" is seeded into the board as a real
                // like tag, so there is one thing to read; see playerTags.js.
                const marker = tagById(tag);
                return marker && (
                    <span className={`player-tag-marker tag-${marker.id}`} title={marker.title}>{marker.symbol}</span>
                );
            })()}
            {(draftedByUs || team === 'KC') && <div className="card-glow"></div>}
        </div>
    );
};

export default React.memo(PlayerCard);
