import React from 'react';

const BottomPanel = ({ yourPicks }) => {
    return (
        <div className="bottom-panel">
            <h3 className="panel-title" style={{ margin: 0, minWidth: '120px' }}>Your Picks</h3>
            <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', flex: 1 }}>
                {yourPicks.map(player => (
                    <div
                        key={player.name}
                        className="player-card ours"
                        style={{
                            minWidth: '180px',
                            marginBottom: 0,
                            padding: '0.5rem 1rem',
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: '1rem'
                        }}
                    >
                        <div className="player-rank" style={{ fontSize: '1.25rem' }}>#{player.pickNumber}</div>
                        <div>
                            <div className="player-name" style={{ fontSize: '0.9rem' }}>{player.name}</div>
                            <div className="player-pos" style={{ fontSize: '0.7rem' }}>{player.position}</div>
                        </div>
                    </div>
                ))}
                {yourPicks.length === 0 && (
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>No players drafted yet.</div>
                )}
            </div>
        </div>
    );
};

export default BottomPanel;
