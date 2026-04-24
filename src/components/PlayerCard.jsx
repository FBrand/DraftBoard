import React from 'react';

const PlayerCard = ({ player, isBest, onClick, slim, team, displayPick, noStrikethrough, isCurrent, traded, tradeNote }) => {
    const { name, position, overallRank, drafted, draftedByUs, team: draftedTeam } = player;

    const classes = [
        'player-card',
        'anim-fade-in',
        drafted ? 'drafted' : 'available',
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
        <div className={classes} onClick={() => !drafted && onClick && onClick(player)}>
            <div className="card-top">
                <span className="player-rank">{rankDisplay}</span>
                <div className="card-team-info">
                    {traded && tradeNote && (
                        <span className="card-trade-note" style={{ fontSize: '0.62rem', color: 'var(--text-dim)', marginRight: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            {displayTradeNote} 
                            <span style={{ color: '#FFB612', fontWeight: 900, fontSize: '1.2rem', lineHeight: 0.8 }}>⇄</span>
                        </span>
                    )}
                    {pickNo && <span className="card-pick-num">PK {pickNo}</span>}
                    {slim && !pickNo && <div className="player-pos">{position.split('.')[1]}</div>}
                    {teamAbbr && <span className="card-team">{teamAbbr}</span>}
                </div>
            </div>
            <div className="card-bottom">
                <div className="player-name">
                    {name}
                </div>
                {!slim && <div className="player-pos">{position}</div>}
            </div>
            {player.isFavorite && <span className="fav-star">★</span>}
            {(draftedByUs || team === 'KC') && <div className="card-glow"></div>}
        </div>
    );
};

export default React.memo(PlayerCard);
