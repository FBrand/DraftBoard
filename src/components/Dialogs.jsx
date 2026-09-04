import React, { useState } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';

// Small in-app replacements for window.prompt / window.confirm. Native
// browser dialogs are unstyled OS chrome that looks wrong on stream (this is
// a broadcast companion tool — see CLAUDE.md) and can't be dismissed with the
// rest of the app's conventions. Originally private to RosterView; extracted
// once Free Agency needed the same prompt, since it had been falling back to
// a raw window.prompt.

export function TextPromptDialog({ title, placeholder, submitLabel = 'Add', onSubmit, onCancel }) {
    const [value, setValue] = useState('');
    useEscapeKey(onCancel);
    return (
        <div className="modal-overlay rv-inline-dialog" onClick={onCancel}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{title}</h2>
                    <button className="close-btn" onClick={onCancel}>&times;</button>
                </div>
                <form onSubmit={e => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
                    <div className="modal-body">
                        <input
                            autoFocus
                            type="text"
                            value={value}
                            placeholder={placeholder}
                            onChange={e => setValue(e.target.value)}
                        />
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="cancel-pill" onClick={onCancel}>Cancel</button>
                        <button type="submit" className="save-pill" disabled={!value.trim()}>{submitLabel}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', onConfirm, onCancel }) {
    useEscapeKey(onCancel);
    return (
        <div className="modal-overlay rv-inline-dialog" onClick={onCancel}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{title}</h2>
                    <button className="close-btn" onClick={onCancel}>&times;</button>
                </div>
                <div className="modal-body"><p>{message}</p></div>
                <div className="modal-footer">
                    <button className="cancel-pill" onClick={onCancel}>Cancel</button>
                    <button className="save-pill" onClick={onConfirm}>{confirmLabel}</button>
                </div>
            </div>
        </div>
    );
}
