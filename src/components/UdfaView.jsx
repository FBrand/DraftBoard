import React, { useState } from 'react';
import CenterBoard from './CenterBoard';
import UnrankedModal from './UnrankedModal';

// UDFA reuses the exact board-grid Draft uses (see CenterBoard.jsx) — "who's
// left" is already what its default Normal view (isFocusMode=false) shows,
// since that filters to undrafted players. Signing a UDFA (board click or
// the unranked-player modal) is mechanically the same action as drafting a
// player (useDraftState's draftPlayer marks them drafted, assigns a team) —
// same underlying state, no new signing pathway needed; only the
// surrounding chrome differs from Draft view.
export default function UdfaView({ players, draftedPlayers, columnOrder, draftPlayer }) {
    const [isUnrankedOpen, setIsUnrankedOpen] = useState(false);
    const udfaCount = draftedPlayers.filter(p => (p.pickNumber || 0) > 257).length;

    const updateRankingsParam = (newPath) => {
        const params = new URLSearchParams(window.location.search);
        params.set('rankings', newPath);
        window.location.href = `?${params.toString()}`;
    };
    const currentRankings = new URLSearchParams(window.location.search).get('rankings') || '';

    return (
        <div className="roster-view">
            <div className="top-panel">
                <div className="roster-brand">
                    <span className="roster-brand-name">UDFA</span>
                    <span className="roster-brand-sub">SIGN UNDRAFTED FREE AGENTS</span>
                </div>

                <div style={{ width: '20px' }} />

                <div className="board-switcher">
                    <span className="switcher-label">BOARD</span>
                    <div className="switcher-buttons">
                        <button
                            className={`switcher-btn ${!currentRankings || currentRankings.includes('rankings_consensus.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_consensus.csv`)}
                        >Consensus</button>
                        <button
                            className={`switcher-btn ${currentRankings.includes('rankings_dan.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_dan.csv`)}
                        >Dan</button>
                        <button
                            className={`switcher-btn ${currentRankings.includes('rankings_ryan.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_ryan.csv`)}
                        >Ryan</button>
                    </div>
                </div>

                <div style={{ flex: 1 }} />

                <div className="roster-counters">
                    <div className="roster-counter">
                        <div className="roster-counter-label">UDFA SIGNED</div>
                        <div className="roster-counter-value">{udfaCount}</div>
                    </div>
                </div>

                <div className="top-actions">
                    <button onClick={() => setIsUnrankedOpen(true)} className="action-pill">+ Sign Unranked Player</button>
                </div>
            </div>
            <CenterBoard
                players={players}
                onAction={draftPlayer}
                columnOrder={columnOrder}
                isFocusMode={false}
            />

            <UnrankedModal
                key={`udfa-unranked-${isUnrankedOpen}`}
                isOpen={isUnrankedOpen}
                onClose={() => setIsUnrankedOpen(false)}
                onDraft={draftPlayer}
                mode="postdraft"
            />
        </div>
    );
}
