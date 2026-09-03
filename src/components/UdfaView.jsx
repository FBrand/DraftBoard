import React from 'react';
import CenterBoard from './CenterBoard';

// UDFA reuses the exact board-grid Draft uses (see CenterBoard.jsx) — "who's
// left" is already what its default Normal view (isFocusMode=false) shows,
// since that filters to undrafted players. Signing a UDFA is mechanically
// the same action as drafting a player (useDraftState's draftPlayer marks
// them drafted, assigns a team) — same underlying state, no new signing
// pathway needed; only the surrounding labels differ from Draft view.
export default function UdfaView({ players, draftedPlayers, columnOrder, draftPlayer }) {
    const udfaCount = draftedPlayers.filter(p => (p.pickNumber || 0) > 257).length;

    return (
        <div>
            <div className="top-panel">
                <div className="roster-brand">
                    <span className="roster-brand-name">UDFA</span>
                    <span className="roster-brand-sub">SIGN UNDRAFTED FREE AGENTS</span>
                </div>
                <div style={{ flex: 1 }} />
                <div className="roster-counters">
                    <div className="roster-counter">
                        <div className="roster-counter-label">UDFA SIGNED</div>
                        <div className="roster-counter-value">{udfaCount}</div>
                    </div>
                </div>
            </div>
            <CenterBoard
                players={players}
                onAction={draftPlayer}
                columnOrder={columnOrder}
                isFocusMode={false}
            />
        </div>
    );
}
