import React, { useEffect, useRef } from 'react';

const RightPanel = ({ draftedPlayers }) => {
    const scrollRef = useRef(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [draftedPlayers]);

    return (
        <div className="side-panel">
            <h3 className="panel-title">Drafted Players</h3>
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
                {draftedPlayers.map((player, index) => (
                    <div
                        key={`${player.name}-${index}`}
                        style={{
                            padding: '0.5rem',
                            borderBottom: '1px solid var(--border-color)',
                            fontSize: '0.875rem',
                            display: 'flex',
                            gap: '0.5rem',
                            backgroundColor: player.draftedByUs ? 'rgba(34, 197, 94, 0.2)' : 'transparent'
                        }}
                    >
                        <span style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>#{player.pickNumber}</span>
                        <span>{player.name}</span>
                        <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>{player.position}</span>
                    </div>
                ))}
            </div>
        </div >
    );
};

export default RightPanel;
