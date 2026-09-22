import React, { useState, useCallback } from 'react';
import useDraftState from './hooks/useDraftState';
import DraftView from './components/DraftView';
import UdfaView from './components/UdfaView';
import ScoutingView from './components/ScoutingView';
import FreeAgencyView from './components/FreeAgencyView';
import RosterView from './components/RosterView';
import PlayerInfoModal from './components/PlayerInfoModal';
import Menu from './components/Menu';
import HelpModal from './components/HelpModal';
import SeasonModal from './components/SeasonModal';
import SyncStatus from './components/SyncStatus';
import SessionUser from './components/SessionUser';
import ManageExpertsModal from './components/ManageExpertsModal';
import { currentSeason, setViewedSeason, createBoard, hasSharedBoard } from './utils/boardRegistry';
import { invalidateBoards } from './hooks/useBoardRankings';
import { editRefusal } from './utils/permissions';
import { onAuthChange } from './utils/auth';
import { backendName } from './data/backend';
import { repository } from './data/repository';
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
    importDraftState,
    placePlayer
  } = useDraftState();

  // The active stage lives in the URL so a view can be linked to. localStorage
  // is only the fallback for "where was I last time", used when the URL says
  // nothing — a shared link always wins over the recipient's last session.
  const [helpOpen, setHelpOpen] = useState(false);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [seasonEpoch, setSeasonEpoch] = useState(0);
  const [expertsModalOpen, setExpertsModalOpen] = useState(false);

  // Subscribed directly (not read once) so "Manage Experts…" appears the
  // moment sign-in actually resolves, rather than staying hidden until some
  // unrelated re-render happens to run after it. Free on a local build, same
  // as SessionUser's own subscription — onAuthChange never touches the SDK.
  const [authUser, setAuthUser] = useState(null);
  React.useEffect(() => onAuthChange(setAuthUser), []);
  const isExpertNow = backendName() === 'firebase' && !!authUser?.isAllowed;

  const activeTabRef = React.useRef(null);

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

  // A write that did not land.
  //
  // The repository shows a change immediately and reaches the store after,
  // which is right for a UI that must not wait and a lie if the store then
  // refuses. It puts the change back — so the screen is correct again — but
  // silently, and a player sliding back to where he was with no explanation
  // reads as the app being broken rather than as a failed save.
  //
  // Against localStorage this fires on a full quota and almost never
  // otherwise. Over a network it is offline, a rule, a timeout: ordinary.
  // The toast fires once, when the queue gives up. Everything before that —
  // one failure, a retry, three more waiting — is the sync indicator's job,
  // because a message per failed attempt while offline is a machine gun.
  // The toast is for a refusal that will not come good on its own. Everything
  // transient — one failure, a retry, three more waiting — is the sync
  // indicator's job, because a message per failed attempt while offline is a
  // machine gun.
  React.useEffect(() => repository.onWriteError(({ permanent, advice, error }) => {
    if (!permanent) return;
    setToast({
      message: `${advice ?? 'Could not save.'} Your work is still on screen. (${error?.message ?? 'write refused'})`,
      tone: 'error',
    });
  }), []);

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

  /**
   * The guarded "new consensus" action — a shared (author-less) board, made
   * through the same createBoard() every other board uses, but only offered
   * (see isExpertNow && !hasSharedBoard() on the menu item below) and only
   * attempted while none already exists for the season. CreateBoardModal's
   * own blank-author field stays available for other legitimately shared
   * boards; this is specifically the guarded, single-purpose version.
   */
  const handleCreateConsensus = async () => {
    if (hasSharedBoard()) return;
    const board = await createBoard({ label: 'Consensus', authorName: '' });
    if (!board) return;
    invalidateBoards();
    setSeasonEpoch(n => n + 1);
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

  // Keep the tab you are ON in view.
  //
  // The bar is wider than a phone screen and scrolls sideways, but it never
  // scrolled itself: measured at 390px, scrollLeft stayed 0 with 405px of
  // scrollable width, so Draft Board was cut in half and UDFA and Roster were
  // off screen entirely — the bar showed three stages you were NOT on, and
  // nothing to say where you were.
  //
  // 'nearest' so a tab already fully visible does not move, which means a
  // desktop scrolls nothing at all.
  React.useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
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
            ref={view === id ? activeTabRef : null}
            onClick={() => setView(id)}
            className={`view-tab${view === id ? ' active' : ''}`}
          >{label}</button>
        ))}

        {/* Whole-app session lives here rather than in any one view — it
            spans all five stages, so it doesn't belong to any of them. The
            per-view CSV exports remain untouched in their own toolbars. */}
        <div className="view-tabbar-actions">
          {/* Next to Session rather than inside it: the guide is the one thing
              somebody reaches for when they do not yet know where anything is,
              so it should not be behind a menu. */}
          <button
            type="button"
            className="view-tab help-tab"
            onClick={() => setHelpOpen(true)}
            title="How this app works"
          >? Help</button>
          {/* "Session" named one of the things in here. It now also holds the
              season stack, which outlives any session — a session is what you
              have open, a season is what the work belongs to. */}
          {/* Only speaks up when there is something to say — see SyncStatus. */}
          <SyncStatus onExport={handleSessionExport} />
          {/* Silent on a local build and for a viewer who never signs in. */}
          <SessionUser />
          <Menu
            label="Manage"
            items={[
              isExpertNow
                ? { label: 'Manage Experts…', onClick: () => setExpertsModalOpen(true), title: 'View and add authorized experts' }
                : null,
              isExpertNow && !hasSharedBoard()
                ? { label: 'New Consensus Board', onClick: handleCreateConsensus, title: 'A shared board nobody owns individually — offered once, when the season has none yet' }
                : null,
              { label: 'Seasons…', onClick: () => setSeasonOpen(true), title: 'Switch season, roll over to a new one, or roll back' },
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
          : <ScoutingView key={seasonEpoch} players={players} columnOrder={columnOrder} />
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
              placePlayer={placePlayer}
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
              undoAction={undoAction}
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
        // Draft and UDFA are stages where the BOARD is the subject, so the
        // card edits opinions there. Roster and Free Agency look at one player
        // out of context and edit facts only.
        editsOpinions={view === 'draft' || view === 'udfa'}
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
      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* The banner says WHY, because a stage that silently refuses to change
          looks broken. The reason comes from the same function the stores ask,
          so the explanation cannot drift from the rule. */}
      {editRefusal({ kind: 'stage' }) && (
        <div className="season-banner">
          <span>
            {editRefusal({ kind: 'stage' }).message} Evaluations can still be added.
          </span>
          <button
            type="button"
            className="action-pill"
            onClick={() => { setViewedSeason(currentSeason()?.id); window.location.reload(); }}
          >Back to {currentSeason()?.year}</button>
        </div>
      )}

      <SeasonModal
        isOpen={seasonOpen}
        onClose={() => setSeasonOpen(false)}
        onChanged={() => setSeasonEpoch(n => n + 1)}
      />

      <ManageExpertsModal
        isOpen={expertsModalOpen}
        onClose={() => setExpertsModalOpen(false)}
      />

    </div>
  );
}

export default App;
