import React, { useState } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';
import {
    DEFAULT_POSITION_VALUE, getPositionValue, setPositionValue, setAthleticMatrixUrl,
} from '../utils/appSettings';
import { getAthleticMatrixUrl } from '../utils/appLinks';

/**
 * Settings that belong to the tool rather than to a board.
 *
 * Both of these were already configurable — one from a hardcoded list nobody
 * could reach, the other from a URL parameter you had to know to construct.
 * Neither is per board on purpose: positional value is how the tool breaks
 * ties when an analyst hasn't spoken, and having it differ between boards
 * would make untouched boards disagree for reasons nobody chose.
 */
export default function SettingsModal({ isOpen, onClose, onChanged }) {
    const [positions, setPositions] = useState(() => getPositionValue().join(', '));
    const [matrixUrl, setMatrixUrl] = useState(() => getAthleticMatrixUrl());
    const [error, setError] = useState('');

    useEscapeKey(onClose, isOpen);
    if (!isOpen) return null;

    const save = () => {
        const result = setAthleticMatrixUrl(matrixUrl);
        if (!result.ok) {
            return setError('That link needs to be a full http:// or https:// address.');
        }
        setPositionValue(positions);
        setError('');
        onChanged?.();
        onClose();
    };

    const resetPositions = () => setPositions(DEFAULT_POSITION_VALUE.join(', '));

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content app-settings" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Settings</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="ap-error">{error}</div>}

                <div className="settings-body">
                    <label className="settings-field">
                        <span className="settings-label">Positional value</span>
                        <span className="settings-hint">
                            Most valuable first. Decides the order of players nobody has placed
                            yet — dragging a player or typing his rank always wins over it.
                            Applies to every board.
                        </span>
                        <textarea
                            className="text-input settings-textarea"
                            rows={3}
                            value={positions}
                            onChange={e => setPositions(e.target.value)}
                        />
                        <button type="button" className="ap-link settings-reset" onClick={resetPositions}>
                            Reset to the shipped order
                        </button>
                    </label>

                    <label className="settings-field">
                        <span className="settings-label">Athletic Matrix link</span>
                        <span className="settings-hint">
                            Where the credit on a scouting card points. Leave empty for the default.
                        </span>
                        <input
                            type="url"
                            className="text-input"
                            value={matrixUrl}
                            placeholder="https://…"
                            onChange={e => setMatrixUrl(e.target.value)}
                        />
                    </label>
                </div>

                <div className="modal-actions ap-actions">
                    <div style={{ flex: 1 }} />
                    <button type="button" className="action-button secondary" onClick={onClose}>Cancel</button>
                    <button type="button" className="action-button primary" onClick={save}>Save</button>
                </div>
            </div>
        </div>
    );
}
