import React, { useState } from 'react';
import CenterBoard from './CenterBoard';
import UnrankedModal from './UnrankedModal';
import usePlayerTags from '../hooks/usePlayerTags';

// UDFA reuses the exact board-grid Draft uses (see CenterBoard.jsx) — "who's
// left" is already what its default Normal view (isFocusMode=false) shows,
// since that filters to undrafted players.
//
// Signing goes through useDraftState's signUndrafted, NOT draftPlayer. It
// looked like the same action, but draftPlayer stamps the current pick number
// and advances the draft, so clicking a UDFA card mid-draft consumed a real
// pick and recorded the signing in draft order.
export default function UdfaView({ players, draftedPlayers, columnOrder, signUndrafted, currentPick, onInfoOpen }) {
    const [isUnrankedOpen, setIsUnrankedOpen] = useState(false);
    const tagFor = usePlayerTags();
    const udfaCount = draftedPlayers.filter(p => (p.pickNumber || 0) > 257).length;

    // A player is undrafted only once the draft is over, so signing is held
    // back until then. The board stays visible and browsable in the meantime —
    // seeing who is likely to go undrafted is exactly what you want beforehand
    // — but clicking a card can't record a signing.
    const draftComplete = (currentPick || 1) > 257;

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
                    {!draftComplete && (
                        <span className="udfa-locked-note" title={`The draft is still on pick ${currentPick}`}>
                            Signing opens when the draft ends
                        </span>
                    )}
                    <button
                        onClick={() => setIsUnrankedOpen(true)}
                        className="action-pill"
                        disabled={!draftComplete}
                    >+ Sign Unranked Player</button>
                </div>
            </div>
            <CenterBoard
                players={players}
                onAction={draftComplete ? signUndrafted : undefined}
                columnOrder={columnOrder}
                isFocusMode={false}
                onInfoOpen={onInfoOpen}
                tagFor={tagFor}
            />

            <UnrankedModal
                key={`udfa-unranked-${isUnrankedOpen}`}
                isOpen={isUnrankedOpen}
                onClose={() => setIsUnrankedOpen(false)}
                onDraft={signUndrafted}
                mode="postdraft"
            />
        </div>
    );
}
