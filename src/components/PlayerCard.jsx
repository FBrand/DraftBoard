import React from 'react';

const PlayerCard = ({ player, isBest, onClick, slim, team, displayPick, noStrikethrough, isCurrent }) => {
    const { name, position, overallRank, drafted, draftedByUs } = player;

    const classes = [
        'player-card',
        'anim-fade-in',
        drafted ? 'drafted' : 'available',
        draftedByUs || (team === 'KC') ? 'ours' : '',
        isBest ? 'best' : '',
        slim ? 'slim' : '',
        noStrikethrough ? 'no-strike' : '',
        isCurrent ? 'current' : ''
    ].join(' ');

    const pickNo = displayPick || player.pickNumber;
    const teamAbbr = team || (draftedByUs ? 'KC' : null);
    const rankDisplay = overallRank && overallRank !== '-' ? `#${overallRank}` : '';

    return (
        <div className={classes} onClick={() => !drafted && onClick && onClick(player)}>
            <div className="card-top">
                <span className="player-rank">{rankDisplay}</span>
                <div className="card-team-info">
                    {pickNo && <span className="card-pick-num">PK {pickNo}</span>}
                    {teamAbbr && <span className="card-team">{teamAbbr}</span>}
                </div>
            </div>
            <div className="card-bottom">
                <div className="player-name">{name}</div>
                {!slim && <div className="player-pos">{position}</div>}
            </div>
            {(draftedByUs || team === 'KC') && <div className="card-glow"></div>}
        </div>
    );
};

export default PlayerCard;
