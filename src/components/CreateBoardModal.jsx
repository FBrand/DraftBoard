import React, { useState, useRef } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';

/**
 * Making a new board.
 *
 * A board is one person's ranking of the class, so the two things worth
 * asking are whose it is and what it starts from. The CSV is optional on
 * purpose: an empty board is a legitimate starting point — every player shows
 * as unranked and you place them as you watch — and requiring a file would
 * mean nobody could start a board without first producing one.
 *
 * The name is the board's LABEL, which renames freely. The author is a
 * separate field because the same person may keep several boards, and because
 * a board with no author is what consensus is.
 */
export default function CreateBoardModal({ isOpen, onClose, onCreate }) {
    const [label, setLabel] = useState('');
    const [author, setAuthor] = useState('');
    const [file, setFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const fileRef = useRef(null);

    useEscapeKey(onClose, isOpen);
    if (!isOpen) return null;

    const submit = async (e) => {
        e.preventDefault();
        if (!label.trim() || busy) return;
        setBusy(true);
        try {
            await onCreate({ label: label.trim(), authorName: author.trim(), file });
            onClose();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>New Board</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={submit} className="picks-form">
                    <div className="form-group">
                        <label>Board Name</label>
                        <input
                            type="text"
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            placeholder="e.g. Ryan"
                            autoFocus
                            className="text-input"
                        />
                    </div>

                    <div className="form-group">
                        <label>Author <span className="ap-hint-inline">optional</span></label>
                        <input
                            type="text"
                            value={author}
                            onChange={e => setAuthor(e.target.value)}
                            placeholder="Whose board this is — blank for a derived board"
                            className="text-input"
                        />
                    </div>

                    <div className="form-group">
                        <label>Start from a CSV <span className="ap-hint-inline">optional</span></label>
                        <div className="cb-file-row">
                            <button type="button" className="action-button secondary" onClick={() => fileRef.current?.click()}>
                                Choose file…
                            </button>
                            <span className="cb-file-name">{file ? file.name : 'Empty board — every player starts unranked'}</span>
                            <input
                                type="file"
                                accept=".csv"
                                ref={fileRef}
                                hidden
                                onChange={e => setFile(e.target.files?.[0] ?? null)}
                            />
                        </div>
                    </div>

                    <div className="modal-actions" style={{ marginTop: 20 }}>
                        <div style={{ flex: 1 }} />
                        <button type="button" className="action-button secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="action-button primary" disabled={!label.trim() || busy}>
                            {busy ? 'Creating…' : 'Create Board'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
