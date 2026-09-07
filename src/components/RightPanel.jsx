import React, { useEffect, useRef, useState, useCallback } from 'react';
import PlayerCard from './PlayerCard';
import Toast from './Toast';
import Menu from './Menu';

const RightPanel = ({ remotePicks, draftedPlayers, currentPick }) => {
    const scrollRef = useRef(null);
    const currentPickRef = useRef(null);
    const [toast, setToast] = useState(null);
    const dismissToast = useCallback(() => setToast(null), []);

    // Auto-scroll to current pick — scoped to this panel's own scroll
    // container. scrollIntoView() walks up and scrolls EVERY scrollable
    // ancestor into view, which was force-scrolling the left panel and
    // center board too; scrollTo() on scrollRef only touches this list.
    useEffect(() => {
        const container = scrollRef.current;
        const el = currentPickRef.current;
        if (container && el) {
            // getBoundingClientRect deltas, not offsetTop — offsetTop is
            // relative to the nearest positioned ancestor, which may not be
            // this container (there's an unpositioned .tracker-list wrapper
            // in between), so it can't be trusted to compute a clean offset.
            const containerRect = container.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const delta = (elRect.top + elRect.height / 2) - (containerRect.top + containerRect.height / 2);
            container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
        }
    }, [currentPick, remotePicks.length]);

    const renderPickCard = (p) => {
        const isCurrent = p.overall === currentPick;
        let player = draftedPlayers.find(dp => dp.pickNumber === p.overall);
        if (!player && p.player) {
            player = { ...p.player, drafted: true };
        } else if (!player) {
            player = { name: "", position: "", overallRank: "", drafted: false };
        }

        return (
            <div key={p.overall} ref={isCurrent ? currentPickRef : null}>
                <PlayerCard
                    player={player}
                    team={p.team}
                    displayPick={p.overall}
                    isBest={false}
                    noStrikethrough={true}
                    isCurrent={isCurrent}
                    traded={p.traded}
                    tradeNote={p.tradeNote}
                />
            </div>
        );
    };

    const displayPicks = remotePicks.length > 0 ? remotePicks : Array.from({ length: 259 }, (_, i) => {
        const overall = i + 1;
        const player = draftedPlayers.find(dp => dp.pickNumber === overall);
        return {
            overall,
            team: player?.draftedByUs ? "KC" : "-",
            player,
            traded: false,
            tradeNote: ""
        };
    });

    return (
        <div className="side-panel right-panel">
            <h3 className="panel-title">Picks</h3>

            <div className="panel-content scroll-container" ref={scrollRef}>
                <div className="tracker-list">
                    {displayPicks.map(renderPickCard)}
                </div>
            </div>

            {/* "Save Session" here only ever meant the PICKS. The tab bar has
                a Session menu that covers every stage, so two things called a
                session did two different jobs a metre apart. Named for what it
                is, and moved into a menu like every other occasional action. */}

            <Toast message={toast?.message} tone={toast?.tone} onDismiss={dismissToast} />
        </div>
    );
};

export default RightPanel;
