import React, { useState } from 'react';
import TopPanelDraft from './TopPanel_Draft';
import LeftPanel from './LeftPanel';
import CenterBoard from './CenterBoard';
import RightPanel from './RightPanel';
import BottomPanel from './BottomPanel';
import PicksModal from './PicksModal';
import UnrankedModal from './UnrankedModal';

// Owns all Draft-view-local UI state (focus mode, sidebar toggles, modals) —
// previously lived at App level, which doesn't scale as more top-level
// stages get added. Pure hoist of App.jsx's old `view === 'draft'` branch;
// no behavior change.
export default function DraftView({
    players, ourPicksLeft, draftedPlayers, yourPicks, currentPick, remotePicks,
    isLiveSync, canLiveSync, toggleLiveSync, draftPlayer, updateOurPicks,
    resetDraft, undoAction, columnOrder, importDraftState,
}) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isUnrankedModalOpen, setIsUnrankedModalOpen] = useState(false);
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
        <div className={isFocusMode ? 'focus-mode' : ''}>
            <TopPanelDraft
                currentPick={currentPick}
                currentPickStatus={currentPickStatus}
                ourPicksLeft={ourPicksLeft}
                onUndo={undoAction}
                onUpdatePicks={() => setIsModalOpen(true)}
                onReset={resetDraft}
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
                            onDraft={draftPlayer}
                            onDraftUnranked={() => setIsUnrankedModalOpen(true)}
                        />
                    )}
                </div>

                <CenterBoard
                    players={players}
                    onAction={draftPlayer}
                    columnOrder={columnOrder}
                    isFocusMode={isFocusMode}
                />

                <div className={`right-sidebar-wrapper ${showRightSidebar && !isFocusMode ? 'mobile-open' : ''}`}>
                    {!isFocusMode && (
                        <RightPanel
                            remotePicks={remotePicks}
                            draftedPlayers={draftedPlayers}
                            currentPick={currentPick}
                            ourPicksLeft={ourPicksLeft}
                            onImport={importDraftState}
                        />
                    )}
                </div>
            </div>

            {!isFocusMode && <BottomPanel yourPicks={yourPicks} />}

            <PicksModal
                key={`picks-${isModalOpen}`}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                initialPicks={ourPicksLeft}
                onSave={updateOurPicks}
            />

            <UnrankedModal
                key={`unranked-${isUnrankedModalOpen}`}
                isOpen={isUnrankedModalOpen}
                onClose={() => setIsUnrankedModalOpen(false)}
                onDraft={draftPlayer}
                mode={(currentPick || 1) > 257 ? 'postdraft' : 'draft'}
            />
        </div>
    );
}
