import React, { useState, useRef } from 'react';
import { serializeDraftState, deserializeDraftState, getExportFilename } from '../utils/sessionSerializer';
import TopPanelDraft from './TopPanel_Draft';
import LeftPanel from './LeftPanel';
import CenterBoard from './CenterBoard';
import RightPanel from './RightPanel';
import BottomPanel from './BottomPanel';
import PicksModal from './PicksModal';
import UnrankedModal from './UnrankedModal';
import { isDraftComplete, isUndraftedSigning, isDraftPick } from '../utils/draftPhase';
import usePlayerTags from '../hooks/usePlayerTags';

// Owns all Draft-view-local UI state (focus mode, sidebar toggles, modals) —
// previously lived at App level, which doesn't scale as more top-level
// stages get added. Pure hoist of App.jsx's old `view === 'draft'` branch;
// no behavior change.
export default function DraftView({
    players, ourPicksLeft, draftedPlayers, yourPicks, currentPick, remotePicks,
    isLiveSync, canLiveSync, toggleLiveSync, draftPlayer, updateOurPicks,
    resetDraft, undoAction, columnOrder, importDraftState, onInfoOpen, signUndrafted, placePlayer,
}) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const tagFor = usePlayerTags();
    const [isUnrankedModalOpen, setIsUnrankedModalOpen] = useState(false);
    // The board is editable during a draft for the same reason Scouting's is:
    // a player rises on Friday night and the board has to say so before you
    // are on the clock. Off by default — mid-draft, a stray drag is expensive.
    const [boardEditable, setBoardEditable] = useState(false);
    const picksFileRef = useRef(null);

    const handleSavePicks = () => {
        const csv = serializeDraftState(draftedPlayers, ourPicksLeft);
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = getExportFilename();
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleLoadPicks = () => picksFileRef.current?.click();

    const handlePicksFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const imported = deserializeDraftState(await file.text());
            if (imported.draftedPlayers.length || imported.ourPicksLeft.length) importDraftState(imported);
        } catch { /* a bad file should not take the draft down mid-broadcast */ }
        e.target.value = '';
    };
    // Once the draft is over there are no picks left to spend, so clicking a
    // player opens the sign dialog prefilled with him instead of recording a
    // phantom pick at 258. UnrankedModal has supported `initialPlayer` for a
    // long time; nothing had ever passed it.
    const [signPlayer, setSignPlayer] = useState(null);
    const draftComplete = isDraftComplete(currentPick);
    const [isFocusMode, setIsFocusMode] = useState(() => {
        const saved = localStorage.getItem('draft_board_focus');
        return saved === 'true';
    });
    const [showLeftSidebar, setShowLeftSidebar] = useState(false);
    const [showRightSidebar, setShowRightSidebar] = useState(false);

    React.useEffect(() => {
        localStorage.setItem('draft_board_focus', isFocusMode);
    }, [isFocusMode]);

    const currentPickData = remotePicks.find(p => p.overall === currentPick);
    const currentPickStatus = currentPickData?.status ? currentPickData.status.replace(/_/g, ' ') : 'NOW DRAFTING';

    return (
        <div className={`draft-view-shell${isFocusMode ? ' focus-mode' : ''}`}>
            <TopPanelDraft
                currentPick={currentPick}
                currentPickStatus={currentPickStatus}
                ourPicksLeft={ourPicksLeft}
                onUndo={undoAction}
                onUpdatePicks={() => setIsModalOpen(true)}
                onReset={resetDraft}
                onDraftUnranked={() => setIsUnrankedModalOpen(true)}
                onSavePicks={handleSavePicks}
                onLoadPicks={handleLoadPicks}
                boardEditable={boardEditable}
                onToggleBoardEdit={() => setBoardEditable(v => !v)}
                isLiveSync={isLiveSync}
                canLiveSync={canLiveSync}
                toggleLiveSync={toggleLiveSync}
                isFocusMode={isFocusMode}
                onToggleFocus={() => setIsFocusMode(f => !f)}
                onSetFocus={setIsFocusMode}
            />

            {!isFocusMode && (
                <>
                    <button
                        className={`sidebar-toggle toggle-left ${showLeftSidebar && !isFocusMode ? 'active' : ''}`}
                        onClick={() => setShowLeftSidebar(!showLeftSidebar)}
                        aria-label="Toggle Rankings"
                    >
                        {showLeftSidebar ? '✕' : '📊'}
                    </button>
                    <button
                        className={`sidebar-toggle toggle-right ${showRightSidebar && !isFocusMode ? 'active' : ''}`}
                        onClick={() => setShowRightSidebar(!showRightSidebar)}
                        aria-label="Toggle Picks"
                    >
                        {showRightSidebar ? '✕' : '🕒'}
                    </button>
                </>
            )}

            <div className="main-layout">
                <div className={`left-sidebar-wrapper ${showLeftSidebar && !isFocusMode ? 'mobile-open' : ''}`}>
                    {!isFocusMode && (
                        <LeftPanel
                            players={players}
                            onDraft={draftComplete ? setSignPlayer : draftPlayer}
                            onInfoOpen={onInfoOpen}
                            tagFor={tagFor}
                        />
                    )}
                </div>

                <CenterBoard
                    players={players}
                    onAction={draftComplete ? setSignPlayer : draftPlayer}
                    columnOrder={columnOrder}
                    isFocusMode={isFocusMode}
                    onInfoOpen={onInfoOpen}
                    tagFor={tagFor}
                    editable={boardEditable}
                    onPlace={placePlayer}
                    // Drafted means drafted. A player signed as a UDFA went
                    // undrafted, so he stays available here.
                    takenTest={isDraftPick}
                />

                <div className={`right-sidebar-wrapper ${showRightSidebar && !isFocusMode ? 'mobile-open' : ''}`}>
                    {!isFocusMode && (
                        <RightPanel
                            remotePicks={remotePicks}
                            draftedPlayers={draftedPlayers}
                            currentPick={currentPick}
                        />
                    )}
                </div>
            </div>

            {/* Picks only. A UDFA is a signing and belongs to the UDFA stage,
                which has its own panel for them. */}
            {!isFocusMode && <BottomPanel yourPicks={yourPicks.filter(p => !isUndraftedSigning(p))} />}

            <PicksModal
                key={`picks-${isModalOpen}`}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                initialPicks={ourPicksLeft}
                onSave={updateOurPicks}
            />

            {/* Prefilled with the clicked player, post-draft only. */}
            <input type="file" accept=".csv" ref={picksFileRef} onChange={handlePicksFile} hidden />

            <UnrankedModal
                key={`sign-${signPlayer?.name ?? 'none'}`}
                isOpen={!!signPlayer}
                onClose={() => setSignPlayer(null)}
                onDraft={signUndrafted}
                mode="postdraft"
                initialPlayer={signPlayer}
            />

            <UnrankedModal
                key={`unranked-${isUnrankedModalOpen}`}
                isOpen={isUnrankedModalOpen}
                onClose={() => setIsUnrankedModalOpen(false)}
                onDraft={draftComplete ? signUndrafted : draftPlayer}
                mode={draftComplete ? 'postdraft' : 'draft'}
            />
        </div>
    );
}
