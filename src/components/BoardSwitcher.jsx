import React from 'react';
import Menu from './Menu';

/**
 * Choosing which analyst's board you are looking at.
 *
 * Three boards fit across a toolbar as buttons and read at a glance, which is
 * what you want on a broadcast. A fourth does not — and the number is not
 * fixed, because boards are documents now and an expert can be added.
 *
 * So past three it splits: consensus stays a button, because it is the one
 * board that is always there and the one you flip back to, and the personal
 * boards collapse into a dropdown named after whoever is currently showing.
 * That keeps the common move one click and stops the toolbar growing without
 * limit.
 *
 * Consensus is identified by having no author — it is derived rather than
 * written by a person (see boardRegistry.js) — not by being called
 * "Consensus", which is a label somebody can rename.
 */
const INLINE_LIMIT = 3;

export default function BoardSwitcher({ boards, activeId, onSelect, label = 'BOARD' }) {
    const list = boards ?? [];
    if (!list.length) return null;

    const inline = list.length <= INLINE_LIMIT;
    const consensus = list.find(b => !b.authorId) ?? null;
    const personal = list.filter(b => b !== consensus);
    const activePersonal = personal.find(b => b.id === activeId) ?? null;

    return (
        <div className="board-switcher">
            <span className="switcher-label">{label}</span>
            <div className="switcher-buttons">
                {inline ? list.map(b => (
                    <button
                        key={b.id}
                        className={`switcher-btn ${b.id === activeId ? 'active' : ''}`}
                        onClick={() => onSelect(b)}
                    >{b.label}</button>
                )) : (
                    <>
                        {consensus && (
                            <button
                                className={`switcher-btn ${consensus.id === activeId ? 'active' : ''}`}
                                onClick={() => onSelect(consensus)}
                            >{consensus.label}</button>
                        )}
                        <Menu
                            // Named for whoever is showing, so the toolbar
                            // still answers "whose board is this" without
                            // being opened.
                            label={activePersonal ? activePersonal.label : 'Experts'}
                            align="left"
                            items={personal.map(b => ({
                                label: b.label,
                                onClick: () => onSelect(b),
                                title: b.id === activeId ? 'Currently showing' : `Show ${b.label}'s board`,
                            }))}
                        />
                    </>
                )}
            </div>
        </div>
    );
}
