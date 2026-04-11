import React, { useState } from 'react';
import useDraftState from './hooks/useDraftState';
import TopPanel from './components/TopPanel';
import LeftPanel from './components/LeftPanel';
import CenterBoard from './components/CenterBoard';
import RightPanel from './components/RightPanel';
import BottomPanel from './components/BottomPanel';
import PicksModal from './components/PicksModal';

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
    columnOrder
  } = useDraftState();

  const [isModalOpen, setIsModalOpen] = useState(false);

  if (loading) return <div className="loading">Loading Chiefs Draft Board...</div>;

  return (
    <div className="app-container">
      <TopPanel
        currentPick={currentPick}
        ourPicksLeft={ourPicksLeft}
        onUndo={undoAction}
        onUpdatePicks={() => setIsModalOpen(true)}
        onReset={resetDraft}
        isLiveSync={isLiveSync}
        canLiveSync={canLiveSync}
        toggleLiveSync={toggleLiveSync}
      />

      <div className="main-layout">
        <LeftPanel players={players} onDraft={draftPlayer} />
        <CenterBoard
          players={players}
          onDraft={draftPlayer}
          columnOrder={columnOrder}
        />
        <RightPanel
          remotePicks={remotePicks}
          draftedPlayers={draftedPlayers}
          currentPick={currentPick}
        />
      </div>

      <BottomPanel yourPicks={yourPicks} />

      <PicksModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialPicks={ourPicksLeft}
        onSave={updateOurPicks}
      />
    </div>
  );
}

export default App;
