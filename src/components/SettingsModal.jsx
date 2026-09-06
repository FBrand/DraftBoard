import React, { useState } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';
import {
    DEFAULT_POSITION_VALUE, getPositionValue, setPositionValue, setAthleticMatrixUrl,
    getSessionTeam, setSessionTeam, getRoundSizes, setRoundSizes,
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
    const [team, setTeam] = useState(() => getSessionTeam());
    const [rounds, setRounds] = useState(() => getRoundSizes().join(', '));
    const [error, setError] = useState('');

    useEscapeKey(onClose, isOpen);
    if (!isOpen) return null;

    const save = () => {
        const result = setAthleticMatrixUrl(matrixUrl);
        if (!result.ok) {
            return setError('That link needs to be a full http:// or https:// address.');
        }
        setPositionValue(positions);
        setSessionTeam(team);
        setRoundSizes(rounds);
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
                        <span className="settings-label">Team</span>
                        <span className="settings-hint">
                            Whose offseason this is. Everyone on the roster plays for them,
                            everyone drafted here is drafted by them, and a free-agent
                            candidate is somebody they might sign.
                        </span>
                        <input
                            type="text"
                            className="text-input"
                            value={team}
                            placeholder="KC"
                            onChange={e => setTeam(e.target.value)}
                        />
                    </label>

                    <label className="settings-field">
                        <span className="settings-label">Picks per round</span>
                        <span className="settings-hint">
                            One number per round. Compensatory picks make the rounds uneven
                            and move them every year, so a round cannot be worked out from a
                            pick number — this is what says which round a pick belongs to,
                            and where the draft ends.
                        </span>
                        <input
                            type="text"
                            className="text-input"
                            value={rounds}
                            placeholder="32, 32, 36, 40, 41, 35, 41"
                            onChange={e => setRounds(e.target.value)}
                        />
                        <span className="settings-hint">
                            {(() => {
                                const list = rounds.split(/[\s,]+/).map(n => parseInt(n, 10)).filter(Boolean);
                                const total = list.reduce((a, b) => a + b, 0);
                                return list.length
                                    ? `${list.length} rounds, ${total} picks — the draft ends at ${total}.`
                                    : 'Empty resets to the shipped order.';
                            })()}
                        </span>
                    </label>

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
