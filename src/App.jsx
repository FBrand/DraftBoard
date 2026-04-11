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
    loading,
    draftPlayer,
    updateOurPicks,
    resetDraft,
    undoAction
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
      />

      <div className="main-layout">
        <LeftPanel players={players} />
        <CenterBoard players={players} onDraft={draftPlayer} />
        <RightPanel draftedPlayers={draftedPlayers} onUndo={undoAction} />
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
