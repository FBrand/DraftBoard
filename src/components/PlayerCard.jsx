import React from 'react';

const PlayerCard = ({ player, isBest, onClick, slim }) => {
    const { name, position, overallRank, drafted, draftedByUs } = player;

    const classes = [
        'player-card',
        'anim-fade-in',
        drafted ? 'drafted' : 'available',
        draftedByUs ? 'ours' : '',
        isBest ? 'best' : '',
        slim ? 'slim' : ''
    ].join(' ');

    return (
        <div className={classes} onClick={() => !drafted && onClick(player)}>
            {!slim && <div className="player-rank">#{overallRank}</div>}
            <div className="player-name">{name}</div>
            {!slim && <div className="player-pos">{position}</div>}
            {drafted && !slim && (
                <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                    PICK #{player.pickNumber} {draftedByUs ? '(US)' : ''}
                </div>
            )}
        </div>
    );
};

export default PlayerCard;
