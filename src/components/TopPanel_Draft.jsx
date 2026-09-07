import React, { useState, useCallback } from 'react';
import { exportBoardToImage } from '../utils/exportBoard';
import Toast from './Toast';
import Menu from './Menu';
import BoardSwitcher from './BoardSwitcher';
import { listBoards } from '../utils/boardRegistry';

const TopPanel = ({ currentPick, currentPickStatus, ourPicksLeft, onUndo, onUpdatePicks, onReset, isLiveSync, canLiveSync, toggleLiveSync, isFocusMode, onToggleFocus, onDraftUnranked, onSavePicks, onLoadPicks, boardEditable, onToggleBoardEdit }) => {
    const [isExporting, setIsExporting] = useState(false);
    const [toast, setToast] = useState(null);
    const dismissToast = useCallback(() => setToast(null), []);

    // finally, not a plain sequence: a throwing export used to leave the
    // button stuck in its "exporting" state permanently.
    const handleExport = async () => {
        setIsExporting(true);
        try {
            await exportBoardToImage();
        } catch (err) {
            setToast({ message: err.message, tone: 'error' });
        } finally {
            setIsExporting(false);
        }
    };

    // From the registry, not from filenames written in here: a fourth board
    // or a renamed analyst has to just appear.
    const boards = listBoards();
    // ?board= is the name; ?rankings= is a file. The switcher was reading only
    // the file, so a link carrying just the board selected the right pool and
    // then highlighted the wrong button.
    const currentSlug = new URLSearchParams(window.location.search).get('board');
    const isActive = (board) => (currentSlug ? board.slug === currentSlug : board.order === 0);

    const chooseBoard = (board) => {
        const params = new URLSearchParams(window.location.search);
        params.delete('rankings');   // retired — the board name is the switch
        params.set('board', board.slug);
        window.location.assign(`?${params.toString()}`);
    };


    const picksList = [...ourPicksLeft].filter(p => p >= currentPick).sort((a, b) => a - b);
    // An empty list rendered as a heading with nothing under it, which reads
    // as broken rather than as "you are out of picks" — and after a completed
    // draft that is its permanent state.
    const picksPills = picksList.length
        ? picksList.map(p => (
            <span key={p} className={`pick-pill ${p === currentPick ? 'active' : ''}`}>#{p}</span>
        ))
        : <span className="pick-pill empty">none left</span>;

    // ── Focus Mode ────────────────────────────────────────────────────────────
    if (isFocusMode) {
        return (
            <div className="top-panel top-panel--focus">
                <div className="pick-section">
                    <div className="pick-info">
                        <span className="pick-label">{currentPickStatus || 'NOW DRAFTING'}</span>
                        <span className="pick-number">#{currentPick}</span>
                    </div>
                    <div className="pick-info">
                        {ourPicksLeft.includes(currentPick) && <span className="our-pick-badge">OURS</span>}
                    </div>
                </div>
                <div style={{ width: '10px' }} />
                <div className="our-picks-tracker">
                    <span className="tracker-label">OUR PICKS LEFT</span>
                    <div className="picks-list">
                        {picksPills}
                    </div>
                </div>
                <BoardSwitcher
                    boards={boards}
                    activeId={boards.find(isActive)?.id ?? null}
                    onSelect={chooseBoard}
                />
                <div className="top-actions">
                    <button className="action-pill trade-pill" onClick={onUpdatePicks}>Update Picks</button>
                    <button className="action-pill" onClick={onDraftUnranked}>+ Draft Unranked Player</button>
                    <button
                        className="action-pill export-pill"
                        onClick={handleExport}
                        disabled={isExporting}
                    >
                        {isExporting ? 'Generating...' : 'Export Board'}
                    </button>
                    <button className="action-pill focus-pill" onClick={onToggleFocus}>⛶ Exit Full Board</button>
                    <button className="action-pill undo-pill" onClick={onUndo}>Undo</button>
                </div>

                <Toast message={toast?.message} tone={toast?.tone} onDismiss={dismissToast} />
            </div>
        );
    }

    // ── Normal Mode ───────────────────────────────────────────────────────────
    return (
        <div className="top-panel">
            <div className="pick-section">
                <div className="pick-info">
                    <span className="pick-label">{currentPickStatus || 'NOW DRAFTING'}</span>
                    <span className="pick-number">#{currentPick}</span>
                </div>
                {ourPicksLeft.includes(currentPick) && <span className="our-pick-badge">OURS</span>}
            </div>
            <div style={{ width: '5px' }} />

            <div className="our-picks-tracker">
                <span className="tracker-label">OUR PICKS LEFT</span>
                <div className="picks-list">
                    {picksPills}
                </div>
            </div>

            <div className="top-actions">
                <BoardSwitcher
                    boards={boards}
                    activeId={boards.find(isActive)?.id ?? null}
                    onSelect={chooseBoard}
                />
                {canLiveSync && (
                    <label className="sync-toggle">
                        <input
                            type="checkbox"
                            checked={isLiveSync}
                            onChange={toggleLiveSync}
                        />
                        Live Sync
                    </label>
                )}
                {/* Undo and Full Board stay out here — both are used live,
                    mid-draft. Everything occasional moves into the menu. */}
                <button className="action-pill" onClick={onDraftUnranked}>+ Draft Unranked Player</button>
                <button className="action-pill focus-pill" onClick={onToggleFocus}>⛶ Full Board</button>
                <button className="action-pill undo-pill" onClick={onUndo}>Undo</button>
                <Menu items={[
                    { label: boardEditable ? '✓ Editing board — click to stop' : '✎ Edit Board', onClick: onToggleBoardEdit, title: 'Drag cards between tiers, and into other position columns' },
                    { label: 'Update Our Picks…', onClick: onUpdatePicks },
                    { label: 'Save Picks…', onClick: onSavePicks, title: 'This draft\'s picks and UDFA signings, as CSV' },
                    { label: 'Load Picks…', onClick: onLoadPicks, title: 'Replaces the picks made so far' },
                    { label: 'Export Board Image…', onClick: handleExport, title: 'JPEG snapshot of the board' },
                    { label: 'Reset Draft…', onClick: onReset, tone: 'danger' },
                ]} />
            </div>

            <Toast message={toast?.message} tone={toast?.tone} onDismiss={dismissToast} />
        </div>
    );
};

export default TopPanel;
