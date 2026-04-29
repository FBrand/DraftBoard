import React, { useState } from 'react';
import useDraftState from './hooks/useDraftState';
import TopPanel from './components/TopPanel';
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
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [showLeftSidebar, setShowLeftSidebar] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(false);
  const [view, setView] = useState('draft'); // 'draft' | 'roster'

  if (loading) return <div className="loading">Loading Chiefs Draft Board...</div>;

  const currentPickData = remotePicks.find(p => p.overall === currentPick);
  const currentPickStatus = currentPickData?.status ? currentPickData.status.replace(/_/g, ' ') : 'NOW DRAFTING';

  return (
    <div className={`app-container${isFocusMode ? ' focus-mode' : ''}`}>
      {view === 'draft' && (
        <TopPanel
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
        />
      )}

      {/* View switcher tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '2px solid rgba(255,183,0,0.2)',
        background: 'rgba(0,0,0,0.3)',
        paddingLeft: 16,
      }}>
        {[
          { id: 'draft',  label: '📋 Draft Board' },
          { id: 'roster', label: '🏈 Roster' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            style={{
              background: view === id ? 'rgba(255,183,0,0.12)' : 'transparent',
              border: 'none',
              borderBottom: view === id ? '2px solid #FFD700' : '2px solid transparent',
              color: view === id ? '#FFD700' : 'rgba(255,255,255,0.4)',
              fontWeight: 700,
              fontSize: '0.75rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '8px 18px',
              cursor: 'pointer',
              transition: 'all .15s',
              marginBottom: -2, // align border with tab bar border
            }}
          >{label}</button>
        ))}
      </div>

      {/* ── Roster View ───────────────────────────────────────────────── */}
      {view === 'roster' && <RosterView />}

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
