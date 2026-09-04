import React, { useState } from 'react';
import useDraftState from './hooks/useDraftState';
import DraftView from './components/DraftView';
import UdfaView from './components/UdfaView';
import ScoutingView from './components/ScoutingView';
import FreeAgencyView from './components/FreeAgencyView';
import RosterView from './components/RosterView';
import PlayerInfoModal from './components/PlayerInfoModal';

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

  // Cross-cutting info card (right-click / long-press on a card) outside
  // Scouting — Scouting has its own always-visible info panel, opened via
  // primary click, so this only gets wired into Draft/UDFA.
  const [infoPlayer, setInfoPlayer] = useState(null);

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

      {/* Like Roster, doesn't gate on Draft's loading state — masterPlayers/
          draftedPlayers are only used for name-display metadata, same as
          RosterView, and work fine with whatever's available so far. */}
      {view === 'fa' && <FreeAgencyView masterPlayers={players} draftedPlayers={draftedPlayers} onInfoOpen={setInfoPlayer} />}

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
              onInfoOpen={setInfoPlayer}
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
              onInfoOpen={setInfoPlayer}
            />
          )
      )}

      {view === 'roster' && (
        <RosterView masterPlayers={players} draftedPlayers={draftedPlayers} currentPick={currentPick} onDraft={draftPlayer} onInfoOpen={setInfoPlayer} />
      )}

      <PlayerInfoModal key={infoPlayer?.name ?? 'none'} player={infoPlayer} onClose={() => setInfoPlayer(null)} />
    </div>
  );
}

export default App;
