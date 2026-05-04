import React, { useState } from 'react';

const UnrankedModal = ({ isOpen, onClose, onDraft, isUDFAVersion = false }) => {
    const [name, setName] = useState('');
    const [position, setPosition] = useState('');

    if (!isOpen) return null;

    const handleSubmit = (e, type = 'Draft') => {
        if (e) e.preventDefault();
        if (!name || !position) return;

        let suffix = '';
        if (type === 'UDFA') suffix = 'UDFA';
        if (type === 'MCI') suffix = 'MCI';

        const customPlayer = {
            name: suffix ? `${name}:${suffix}` : name,
            position: position.toUpperCase(),
            overallRank: 999,
            group: 'Custom',
            isUnranked: true
        };

        onDraft(customPlayer);
        setName('');
        setPosition('');
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{isUDFAVersion ? 'Sign Player' : 'Draft Unranked Player'}</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={e => handleSubmit(e)} className="picks-form">
                    <div className="form-group">
                        <label>Player Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g. John Doe"
                            autoFocus
                            className="text-input"
                        />
                    </div>

                    <div className="form-group">
                        <label>Position</label>
                        <input
                            type="text"
                            value={position}
                            onChange={e => setPosition(e.target.value)}
                            placeholder="e.g. LB"
                            className="text-input"
                        />
                    </div>

                    <div className="modal-actions" style={{ flexDirection: 'column', gap: 10, marginTop: 20 }}>
                        {!isUDFAVersion ? (
                            <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                                <button type="button" className="action-button secondary" style={{ flex: 1 }} onClick={onClose}>
                                    Cancel
                                </button>
                                <button type="submit" className="action-button primary" style={{ flex: 1 }} disabled={!name || !position}>
                                    Draft Player
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                                <button type="button" className="action-button primary" style={{ flex: 1 }} onClick={() => handleSubmit(null, 'Sign')}>
                                    SIGN
                                </button>
                                <button type="button" className="action-button primary" style={{ flex: 1, background: 'var(--chiefs-gold)', color: '#000' }} onClick={() => handleSubmit(null, 'UDFA')}>
                                    UDFA
                                </button>
                                <button type="button" className="action-button secondary" style={{ flex: 1 }} onClick={() => handleSubmit(null, 'MCI')}>
                                    MCI
                                </button>
                            </div>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

export default UnrankedModal;
