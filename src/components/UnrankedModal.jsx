import React, { useState } from 'react';

const UnrankedModal = ({ isOpen, onClose, onDraft }) => {
    const [name, setName] = useState('');
    const [position, setPosition] = useState('');

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name || !position) return;

        // Create a mock player object
        const customPlayer = {
            name,
            position: position.toUpperCase(),
            overallRank: 999, // Unranked
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
                    <h2>Draft Unranked Player</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={handleSubmit} className="picks-form">
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

                    <div className="modal-actions">
                        <button type="button" className="action-button secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="action-button primary" disabled={!name || !position}>
                            Draft Player
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default UnrankedModal;
