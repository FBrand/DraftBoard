import React, { useState } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';

// mode: 'draft' | 'roster' | 'postdraft'
// 'draft'     → during draft, draft board: Name+Pos, Draft button
// 'roster'    → during draft, roster view: Name+Pos, Sign FA / Trade
// 'postdraft' → after draft, both views: Name+Pos+Team(KC), Sign FA / Sign UDFA / Invite
const UnrankedModal = ({ isOpen, onClose, onDraft, mode = 'draft', initialPlayer = null }) => {
    const [name, setName] = useState(() => initialPlayer?.name || '');
    const [position, setPosition] = useState(() => initialPlayer?.position || '');
    const [team, setTeam] = useState(() => initialPlayer?.team || 'KC');
    // Where he came from. Only means anything for a move between clubs — a
    // draft pick and a UDFA are entering the league, not leaving somewhere.
    const [previousTeam, setPreviousTeam] = useState(() => initialPlayer?.previousTeam || '');
    useEscapeKey(onClose, isOpen);

    if (!isOpen) return null;

    const disabled = !name || !position;

    // How he arrived is passed alongside the name, not inside it. It used to
    // be appended as ":FA" — and the name is the identity key, so that made
    // one player two.
    const MOVED_CLUBS = new Set(['FA', 'TR']);

    const submit = (suffix = '') => {
        if (disabled) return;
        onDraft({
            name: name.trim(),
            position: position.toUpperCase(),
            arrival: suffix || null,
            ...(mode === 'postdraft' ? { team } : {}),
            ...(MOVED_CLUBS.has(suffix) && previousTeam.trim()
                ? { previousTeam: previousTeam.trim().toUpperCase() }
                : {}),
            overallRank: 999,
            round: null,
            tier: null,
            isUnranked: true,
        });
        onClose();
    };

    const titles = { draft: 'Draft Unranked Player', roster: 'Add Player', postdraft: 'Sign Player' };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{titles[mode]}</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>
                <form onSubmit={e => { e.preventDefault(); submit(); }} className="picks-form">
                    <div className="form-group">
                        <label>Player Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)}
                            placeholder="e.g. John Doe" autoFocus className="text-input" />
                    </div>
                    <div className="form-group">
                        <label>Position</label>
                        <input type="text" value={position} onChange={e => setPosition(e.target.value)}
                            placeholder="e.g. LB" className="text-input" />
                    </div>
                    {mode === 'postdraft' && (
                        <div className="form-group">
                            <label>Team</label>
                            <input type="text" value={team} onChange={e => setTeam(e.target.value)}
                                placeholder="e.g. KC" className="text-input" />
                        </div>
                    )}
                    {/* A signing or a trade comes FROM somewhere; a draft pick
                        and a UDFA do not. */}
                    {(mode === 'roster' || mode === 'postdraft') && (
                        <div className="form-group">
                            <label>Previous Team</label>
                            <input type="text" value={previousTeam}
                                onChange={e => setPreviousTeam(e.target.value)}
                                placeholder="e.g. LV — for a signing or trade" className="text-input" />
                        </div>
                    )}
                    <div className="modal-actions" style={{ marginTop: 20 }}>
                        {mode === 'draft' && (
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button type="button" className="action-button secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
                                <button type="submit" className="action-button primary" style={{ flex: 1 }} disabled={disabled}>Draft</button>
                            </div>
                        )}
                        {mode === 'roster' && (
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button type="button" className="action-button primary" style={{ flex: 1 }} disabled={disabled} onClick={() => submit('FA')}>Sign FA</button>
                                <button type="button" className="action-button secondary" style={{ flex: 1 }} disabled={disabled} onClick={() => submit('TR')}>Trade</button>
                            </div>
                        )}
                        {mode === 'postdraft' && (
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button type="button" className="action-button primary" style={{ flex: 1 }} disabled={disabled} onClick={() => submit('FA')}>Sign FA</button>
                                <button type="button" className="action-button primary" style={{ flex: 1, background: 'var(--chiefs-gold)', color: '#000' }} disabled={disabled} onClick={() => submit('UDFA')}>Sign UDFA</button>
                                <button type="button" className="action-button secondary" style={{ flex: 1 }} disabled={disabled} onClick={() => submit('INV')}>Invite</button>
                            </div>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

export default UnrankedModal;
