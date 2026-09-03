import React, { useState } from 'react';
import useDraftState from './hooks/useDraftState';
import TopPanelDraft from './components/TopPanel_Draft';
import LeftPanel from './components/LeftPanel';
import CenterBoard from './components/CenterBoard';
import RightPanel from './components/RightPanel';
import BottomPanel from './components/BottomPanel';
import PicksModal from './components/PicksModal';
import UnrankedModal from './components/UnrankedModal';
import RosterView from './components/RosterView';

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
  const [isFocusMode, setIsFocusMode] = useState(() => {
    const saved = localStorage.getItem('draft_board_focus');
    return saved === 'true';
  });
  const [showLeftSidebar, setShowLeftSidebar] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(false);
  const [view, setView] = useState(() => {
    return localStorage.getItem('draft_board_view') || 'draft';
  }); // 'draft' | 'roster'

  React.useEffect(() => {
    localStorage.setItem('draft_board_focus', isFocusMode);
  }, [isFocusMode]);

  React.useEffect(() => {
    localStorage.setItem('draft_board_view', view);
  }, [view]);

  if (loading) return <div className="loading">Loading Chiefs Draft Board...</div>;

  const currentPickData = remotePicks.find(p => p.overall === currentPick);
  const currentPickStatus = currentPickData?.status ? currentPickData.status.replace(/_/g, ' ') : 'NOW DRAFTING';

  return (
    <div className={`app-container${isFocusMode ? ' focus-mode' : ''}`}>
      {/* View switcher tabs — always first so it never shifts position when switching views */}
      <div className="view-tabbar">
        {[
          { id: 'draft', label: '📋 Draft Board' },
          { id: 'roster', label: '🏈 Roster' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`view-tab${view === id ? ' active' : ''}`}
          >{label}</button>
        ))}
      </div>

      {view === 'draft' && (
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
      )}

      {/* ── Roster View ───────────────────────────────────────────────── */}
      {view === 'roster' && <RosterView masterPlayers={players} draftedPlayers={draftedPlayers} currentPick={currentPick} onDraft={draftPlayer} />}

      {/* ── Draft View ────────────────────────────────────────────────── */}
      {view === 'draft' && (
        <>
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
              onDraft={draftPlayer}
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
        </>
      )}

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

export default App;
