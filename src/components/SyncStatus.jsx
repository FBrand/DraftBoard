import React, { useEffect, useState } from 'react';
import { repository } from '../data/repository';
import { ConfirmDialog } from './Dialogs';

/**
 * Whether your work has actually been saved.
 *
 * The app writes to memory first and to storage after, so the screen is always
 * instant and is sometimes ahead of the truth. That gap was invisible: a
 * refused write showed a message once and then nothing, and there was no way
 * to ask "am I saved?" — the only honest answer being a reload, which is the
 * one thing you must not do when a write has not landed.
 *
 * Four states, and only two of them say anything:
 *
 *   saved     nothing to say, so it says almost nothing
 *   saving    briefly, in passing
 *   retrying  N changes are on screen and not in storage, and it is trying
 *   failed    it has stopped trying — and THAT is where the export lives,
 *             because a session file is the one way to get the work off this
 *             machine without the backend being involved at all
 */
export default function SyncStatus({ onExport }) {
    const [sync, setSync] = useState(() => repository.syncState());
    const [confirmingDiscard, setConfirmingDiscard] = useState(false);

    useEffect(() => repository.onSyncChange(setSync), []);

    if (sync.state === 'saved') return null;

    const label = {
        saving: 'Saving…',
        retrying: `${sync.pending} unsaved — retrying`,
        failed: `${sync.pending} unsaved — could not save`,
    }[sync.state];

    return (
        <div className={`sync-status sync-status--${sync.state}`} role="status">
            <span className="sync-dot" aria-hidden="true" />
            {/* The advice is the useful half. "Could not save" tells somebody
                to worry; "there is no room left, save to a file and clear old
                seasons" tells them what to do about it. */}
            <span className="sync-label" title={sync.advice ?? undefined}>{label}</span>
            {sync.state === 'failed' && sync.advice && (
                <span className="sync-advice">{sync.advice}</span>
            )}

            {(sync.state === 'retrying' || sync.state === 'failed') && (
                <>
                    {/* Offered while it is still trying, not only once it has
                        given up: somebody who knows the connection is back
                        should not have to sit out a backoff, and somebody who
                        wants their work in a file should not have to wait for
                        the app to despair first. */}
                    <button type="button" className="ap-link" onClick={() => repository.retryNow()}>
                        Try again
                    </button>
                    <button type="button" className="ap-link" onClick={onExport}>
                        Save to a file
                    </button>
                </>
            )}

            {/* Only once it has given up. While it is still retrying the write
                may yet land, and offering to throw it away then would be
                offering to lose work that was never actually lost. A refused
                write is different: it can neither land nor leave, and it sits
                on top of what the store says until somebody drops it. */}
            {sync.state === 'failed' && (
                <button type="button" className="ap-link" onClick={() => setConfirmingDiscard(true)}>
                    Discard them
                </button>
            )}

            {confirmingDiscard && (
                <ConfirmDialog
                    title="Discard these changes?"
                    message={`${sync.pending} change${sync.pending === 1 ? '' : 's'} the database refused to accept will be thrown away, and the page will reload showing what the database actually holds. This cannot be undone — if you want to keep them, cancel and use "Save to a file" first.`}
                    confirmLabel="Discard and reload"
                    onConfirm={() => { repository.discardPending(); window.location.reload(); }}
                    onCancel={() => setConfirmingDiscard(false)}
                />
            )}
        </div>
    );
}
