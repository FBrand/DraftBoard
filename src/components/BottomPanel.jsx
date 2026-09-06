import React from 'react';

// Your picks, left to right.
//
// This did not scroll. The row is a flex child with overflow-x:auto, and a
// flex item's default min-width is auto — so instead of shrinking and
// scrolling its own content, it grew to fit every card and pushed the panel
// wide. min-width:0 is what lets a flex child actually be a scroll container.
const BottomPanel = ({ yourPicks }) => {
    return (
        <div className="bottom-panel">
            <h3 className="panel-title" style={{ margin: 0, minWidth: '120px' }}>Your Picks</h3>
            <div className="bp-picks-row">
                {yourPicks.map(player => (
                    <div
                        key={player.name}
                        className="player-card ours bp-pick"
                        style={{
                            minWidth: '150px',
                            marginBottom: '0.5rem',
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
