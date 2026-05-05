import React, { useState, useEffect } from 'react';

// mode: 'draft' | 'roster' | 'postdraft'
// 'draft'     → during draft, draft board: Name+Pos, Draft button
// 'roster'    → during draft, roster view: Name+Pos, Sign FA / Trade
// 'postdraft' → after draft, both views: Name+Pos+Team(KC), Sign FA / Sign UDFA / Invite
const UnrankedModal = ({ isOpen, onClose, onDraft, mode = 'draft', initialPlayer = null }) => {
    const [name, setName] = useState('');
    const [position, setPosition] = useState('');
    const [team, setTeam] = useState('KC');

    useEffect(() => {
        if (!isOpen) return;
        setName(initialPlayer?.name || '');
        setPosition(initialPlayer?.position || '');
        setTeam(initialPlayer?.team || 'KC');
    }, [isOpen, initialPlayer]);

    if (!isOpen) return null;

    const disabled = !name || !position;

    const submit = (suffix = '') => {
        if (disabled) return;
        onDraft({
            name: suffix ? `${name}:${suffix}` : name,
            position: position.toUpperCase(),
            ...(mode === 'postdraft' ? { team } : {}),
            overallRank: 999,
            group: 'Custom',
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
