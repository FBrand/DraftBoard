import React, { useState } from 'react';
import useDraftState from './hooks/useDraftState';
import TopPanel from './components/TopPanel';
import LeftPanel from './components/LeftPanel';
import CenterBoard from './components/CenterBoard';
import RightPanel from './components/RightPanel';
import BottomPanel from './components/BottomPanel';
import PicksModal from './components/PicksModal';
import UnrankedModal from './components/UnrankedModal';

function App() {
  const {
    players,
    ourPicksLeft,
    draftedPlayers,
    yourPicks,
    currentPick,
    remotePicks,
    loading,
    isLiveSync,
    canLiveSync,
    toggleLiveSync,
    draftPlayer,
    updateOurPicks,
    resetDraft,
    undoAction,
    columnOrder,
    importDraftState
  } = useDraftState();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUnrankedModalOpen, setIsUnrankedModalOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [showLeftSidebar, setShowLeftSidebar] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(false);

  if (loading) return <div className="loading">Loading Chiefs Draft Board...</div>;

  return (
    <div className={`app-container${isFocusMode ? ' focus-mode' : ''}`}>
      <TopPanel
        currentPick={currentPick}
        ourPicksLeft={ourPicksLeft}
        onUndo={undoAction}
        onUpdatePicks={() => setIsModalOpen(true)}
        onReset={resetDraft}
        isLiveSync={isLiveSync}
        canLiveSync={canLiveSync}
        toggleLiveSync={toggleLiveSync}
        isFocusMode={isFocusMode}
        onToggleFocus={() => setIsFocusMode(f => !f)}
      />

      <div className="main-layout">
        {!isFocusMode && (
          <button
            className={`sidebar-toggle toggle-left ${showLeftSidebar ? 'active' : ''}`}
            onClick={() => setShowLeftSidebar(!showLeftSidebar)}
            aria-label="Toggle Rankings"
          >
            {showLeftSidebar ? '✕' : '📊'}
          </button>
        )}

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
          onDraft={draftPlayer}
          columnOrder={columnOrder}
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

        {!isFocusMode && (
          <button
            className={`sidebar-toggle toggle-right ${showRightSidebar ? 'active' : ''}`}
            onClick={() => setShowRightSidebar(!showRightSidebar)}
            aria-label="Toggle Picks"
          >
            {showRightSidebar ? '✕' : '🕒'}
          </button>
        )}
      </div>

      {!isFocusMode && <BottomPanel yourPicks={yourPicks} />}

      <PicksModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialPicks={ourPicksLeft}
        onSave={updateOurPicks}
      />

      <UnrankedModal
        isOpen={isUnrankedModalOpen}
        onClose={() => setIsUnrankedModalOpen(false)}
        onDraft={draftPlayer}
      />
    </div>
  );
}

export default App;
