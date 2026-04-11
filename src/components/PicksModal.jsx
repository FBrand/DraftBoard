import React, { useState, useEffect } from 'react';

const PicksModal = ({ isOpen, onClose, initialPicks, onSave }) => {
    const [picksText, setPicksText] = useState('');

    useEffect(() => {
        if (isOpen) {
            setPicksText(initialPicks.join(', '));
        }
    }, [isOpen, initialPicks]);

    if (!isOpen) return null;

    const handleSave = () => {
        const newPicks = picksText
            .split(',')
            .map(p => parseInt(p.trim(), 10))
            .filter(p => !isNaN(p));

        onSave(newPicks);
        onClose();
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h2>Update Your Picks</h2>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    <p>Enter the pick numbers assigned to the Chiefs, separated by commas.</p>
                    <textarea
                        value={picksText}
                        onChange={(e) => setPicksText(e.target.value)}
                        placeholder="e.g. 32, 64, 96"
                        rows={5}
                    />
                </div>
                <div className="modal-footer">
                    <button className="cancel-pill" onClick={onClose}>Cancel</button>
                    <button className="save-pill" onClick={handleSave}>Save Changes</button>
                </div>
            </div>
        </div>
    );
};

export default PicksModal;
