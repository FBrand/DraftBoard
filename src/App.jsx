import React, { useState, useCallback } from 'react';
import useDraftState from './hooks/useDraftState';
import DraftView from './components/DraftView';
import UdfaView from './components/UdfaView';
import ScoutingView from './components/ScoutingView';
import FreeAgencyView from './components/FreeAgencyView';
import RosterView from './components/RosterView';
import PlayerInfoModal from './components/PlayerInfoModal';
import Menu from './components/Menu';
import Toast from './components/Toast';
import { ConfirmDialog } from './components/Dialogs';
import { exportSession, importSession, sessionFilename } from './utils/appSession';
import { resetTo, INIT_SEEDED, INIT_CLEAN } from './utils/appInit';
import * as faState from './utils/faState';
import useUrlParam from './hooks/useUrlParam';

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
    signUndrafted,
    columnOrder,
    importDraftState
  } = useDraftState();

  // The active stage lives in the URL so a view can be linked to. localStorage
  // is only the fallback for "where was I last time", used when the URL says
  // nothing — a shared link always wins over the recipient's last session.
  const [view, setViewParam] = useUrlParam(
    'view',
    localStorage.getItem('draft_board_view') || 'draft',
    TABS.map(t => t.id),
  );
  const setView = (id) => setViewParam(id);

  // Cross-cutting info card (right-click / long-press on a card) outside
  // Scouting — Scouting has its own always-visible info panel, opened via
  // primary click, so this only gets wired into Draft/UDFA.
  const [infoPlayer, setInfoPlayer] = useState(null);

  const [toast, setToast] = useState(null);
  const dismissToast = useCallback(() => setToast(null), []);
  // Import replaces every stage's state at once, so it asks first. The file
  // is read before confirming — no point warning about an overwrite that a
  // corrupt file would fail anyway.
  const [pendingImport, setPendingImport] = useState(null);
  // Both re-initialisations throw away current work, so both confirm first.
  const [pendingInit, setPendingInit] = useState(null); // INIT_SEEDED | INIT_CLEAN | null

  React.useEffect(() => {
    localStorage.setItem('draft_board_view', view);
  }, [view]);

  // Free agency starts from last season's roster. Seeded here rather than
  // inside its own view because Roster's "Sync from FA/Draft/UDFA" reads free
  // agency out of storage — waiting for someone to open the tab meant the
  // pipeline had nothing to pull from until they did.
  React.useEffect(() => { faState.ensureSeeded(); }, []);

  const handleSessionExport = () => {
    const blob = new Blob([exportSession()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sessionFilename();
    a.click();
    URL.revokeObjectURL(url);
    setToast({ message: 'Full session exported.', tone: 'success' });
  };

  const handleSessionFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setPendingImport({ name: file.name, text: await file.text() });
  };

  const applySessionImport = () => {
    const { text } = pendingImport;
    setPendingImport(null);
    try {
      importSession(text);
      // Every stage keeps its state in its own hook/module, seeded from
      // localStorage at mount — a reload is the honest way to re-seed them
      // all rather than threading setters through five views.
      window.location.reload();
    } catch (err) {
      setToast({ message: err.message, tone: 'error' });
    }
  };

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

        {/* Whole-app session lives here rather than in any one view — it
            spans all five stages, so it doesn't belong to any of them. The
            per-view CSV exports remain untouched in their own toolbars. */}
        <div className="view-tabbar-actions">
          <Menu
            label="Session"
            items={[
              { label: 'Export Full Session…', onClick: handleSessionExport, title: 'Every stage — draft, roster, FA, scouting — in one JSON file' },
              { label: 'Import Full Session…', file: { accept: '.json', onFile: handleSessionFile }, title: 'Replaces all current state' },
              { label: 'Load Current State', onClick: () => setPendingInit(INIT_SEEDED), title: 'The real offseason as it happened — completed draft and the roster it produced' },
              { label: 'Start Clean Slate', onClick: () => setPendingInit(INIT_CLEAN), tone: 'danger', title: 'Empty every stage and build a season from scratch' },
            ]}
          />
        </div>
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
              signUndrafted={signUndrafted}
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
              signUndrafted={signUndrafted}
              currentPick={currentPick}
              onInfoOpen={setInfoPlayer}
            />
          )
      )}

      {view === 'roster' && (
        <RosterView masterPlayers={players} draftedPlayers={draftedPlayers} currentPick={currentPick} onInfoOpen={setInfoPlayer} />
      )}

      <PlayerInfoModal
        key={infoPlayer?.name ?? 'none'}
        player={infoPlayer}
        players={players}
        onClose={() => setInfoPlayer(null)}
      />

      {pendingInit && (
        <ConfirmDialog
          title={pendingInit === INIT_CLEAN ? 'Start from a clean slate?' : 'Load the current state?'}
          message={pendingInit === INIT_CLEAN
            ? 'Every stage starts empty — no draft picks, no roster, no scouting notes. Your current work is discarded.'
            : 'Reloads the real offseason: the completed draft and the roster that came out of free agency, the draft and UDFA signings. Your current work is discarded.'}
          confirmLabel={pendingInit === INIT_CLEAN ? 'Start clean' : 'Load it'}
          onConfirm={() => { resetTo(pendingInit); window.location.reload(); }}
          onCancel={() => setPendingInit(null)}
        />
      )}

      {pendingImport && (
        <ConfirmDialog
          title="Import full session?"
          message={`Restoring "${pendingImport.name}" replaces your current draft, roster, free agency, and scouting data. This cannot be undone.`}
          confirmLabel="Replace everything"
          onConfirm={applySessionImport}
          onCancel={() => setPendingImport(null)}
        />
      )}

      <Toast message={toast?.message} tone={toast?.tone} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
