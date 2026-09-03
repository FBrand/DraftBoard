import React, { useState } from 'react';
import useDraftState from './hooks/useDraftState';
import DraftView from './components/DraftView';
import UdfaView from './components/UdfaView';
import ScoutingView from './components/ScoutingView';
import RosterView from './components/RosterView';

// UDFA and Scouting/FA views land in later phases of the 5-stage build
// (see /home/dev/.claude/plans/structured-growing-cat.md) — placeholder here
// keeps every tab clickable and the app in a working state at each step.
function ComingSoon({ label }) {
  return <div className="loading">{label} — coming soon</div>;
}

const TABS = [
  { id: 'fa', label: '💰 Free Agency' },
  { id: 'scouting', label: '🔎 Scouting' },
  { id: 'draft', label: '📋 Draft Board' },
  { id: 'udfa', label: '🪧 UDFA' },
  { id: 'roster', label: '🏈 Roster' },
];

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

  const [view, setView] = useState(() => {
    return localStorage.getItem('draft_board_view') || 'draft';
  });

  React.useEffect(() => {
    localStorage.setItem('draft_board_view', view);
  }, [view]);

  return (
    <div className="app-container">
      {/* View switcher tabs — always first so it never shifts position when
          the active view changes, and never blocked by Draft's own loading
          state (only the Draft/Scouting views actually need `players`). */}
      <div className="view-tabbar">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`view-tab${view === id ? ' active' : ''}`}
          >{label}</button>
        ))}
      </div>

      {view === 'fa' && <ComingSoon label="Free Agency" />}

      {view === 'scouting' && (
        loading
          ? <div className="loading">Loading Chiefs Draft Board...</div>
          : <ScoutingView players={players} columnOrder={columnOrder} />
      )}

      {view === 'draft' && (
        loading
          ? <div className="loading">Loading Chiefs Draft Board...</div>
          : (
            <DraftView
              players={players}
              ourPicksLeft={ourPicksLeft}
              draftedPlayers={draftedPlayers}
              yourPicks={yourPicks}
              currentPick={currentPick}
              remotePicks={remotePicks}
              isLiveSync={isLiveSync}
              canLiveSync={canLiveSync}
              toggleLiveSync={toggleLiveSync}
              draftPlayer={draftPlayer}
              updateOurPicks={updateOurPicks}
              resetDraft={resetDraft}
              undoAction={undoAction}
              columnOrder={columnOrder}
              importDraftState={importDraftState}
            />
          )
      )}

      {view === 'udfa' && (
        loading
          ? <div className="loading">Loading Chiefs Draft Board...</div>
          : (
            <UdfaView
              players={players}
              draftedPlayers={draftedPlayers}
              columnOrder={columnOrder}
              draftPlayer={draftPlayer}
            />
          )
      )}

      {view === 'roster' && (
        <RosterView masterPlayers={players} draftedPlayers={draftedPlayers} currentPick={currentPick} onDraft={draftPlayer} />
      )}
    </div>
  );
}

export default App;
