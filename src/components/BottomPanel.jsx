import React from 'react';

// Your picks, left to right.
//
// This did not scroll. The row is a flex child with overflow-x:auto, and a
// flex item's default min-width is auto — so instead of shrinking and
// scrolling its own content, it grew to fit every card and pushed the panel
// wide. min-width:0 is what lets a flex child actually be a scroll container.
const BottomPanel = ({ yourPicks }) => {
    // Chrome does not turn a vertical wheel into horizontal scrolling for an
    // ordinary element — that is shift+wheel, which nobody discovers and which
    // is useless on a trackpad-less broadcast machine. overflow-x:auto alone
    // therefore produced a row that could scroll and never did. This makes a
    // plain wheel over the picks move them.
    const onWheel = (e) => {
        const el = e.currentTarget;
        if (el.scrollWidth <= el.clientWidth) return;
        const dominant = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (!dominant) return;
        el.scrollLeft += dominant;
        // Only claim the gesture when this row can still move in that
        // direction; at either end the page should scroll normally.
        const atStart = el.scrollLeft <= 0 && dominant < 0;
        const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth && dominant > 0;
        if (!atStart && !atEnd) e.preventDefault();
    };

    return (
        <div className="bottom-panel">
            <h3 className="panel-title" style={{ margin: 0, minWidth: '120px' }}>Your Picks</h3>
            <div className="bp-picks-row" onWheel={onWheel}>
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
