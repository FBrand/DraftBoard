import React, { useState, useMemo, useCallback } from 'react';
import { groupPlayers, missingFor, placementLabel } from '../utils/grouping';
import { tagById } from '../utils/playerTags';

/**
 * The board as a collapsible list rather than a grid.
 *
 * The grid has a cell for every position × round whether or not anyone is in
 * it, which is what you want while placing players and not what you want while
 * reading them. Grouped, a class with four safeties shows four safeties.
 *
 * Groups start open. A board is something you scan, and opening nine groups
 * before you can read anything is worse than scrolling past the ones you don't
 * want — collapsing is for putting a group away once you're done with it.
 */
function PlayerRow({ player, selected, onSelect, tag, showMissing }) {
    const tagMeta = tag ? tagById(tag) : null;
    const gaps = showMissing ? missingFor(player) : [];

    return (
        <button
            type="button"
            className={`sg-row${selected ? ' selected' : ''}`}
            onClick={() => onSelect(player)}
            title={player.name}
        >
            <span className="sg-rank">{player.overallRank ?? '???'}</span>
            <span className="sg-name">{player.name}</span>
            {tagMeta && <span className="sg-tag" title={tagMeta.title}>{tagMeta.symbol}</span>}
            <span className="sg-meta">
                {gaps.length
                    ? <span className="sg-missing">no {gaps.join(', ')}</span>
                    : `${player.position ?? ''}${placementLabel(player) ? ` · ${placementLabel(player)}` : ''}`}
            </span>
        </button>
    );
}

export default function ScoutingGroupedList({
    players, groupBy, selectedName, onSelect, tagFor, unmatchedInline = false,
}) {
    const [collapsed, setCollapsed] = useState(() => new Set());

    const { groups, unmatched } = useMemo(
        () => groupPlayers(players, groupBy),
        [players, groupBy],
    );

    // Collapsing is per group key, and the keys change when the grouping does,
    // so a stale key simply never matches — nothing to clean up.
    const toggle = useCallback((key) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }, []);

    const rowsFor = (list, showMissing = false) => list.map(p => (
        <PlayerRow
            key={`${p.name}|${p.position}`}
            player={p}
            selected={p.name === selectedName}
            onSelect={onSelect}
            tag={tagFor?.(p.name, p) ?? null}
            showMissing={showMissing}
        />
    ));

    return (
        // unmatchedInline means this is the whole view — one column on screen,
        // so one column of names inside it. The multi-column flow is for the
        // desktop layout, where the list has real width to spend.
        <div className={`sg-list scroll-container${unmatchedInline ? ' sg-list--stacked' : ''}`}>
            {groups.map(group => {
                const isCollapsed = collapsed.has(group.key);
                return (
                    <section key={group.key} className="sg-group">
                        <button
                            type="button"
                            className="sg-group-header"
                            onClick={() => toggle(group.key)}
                            aria-expanded={!isCollapsed}
                        >
                            <span className="sg-chevron" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                            <span className="sg-group-label">{group.label}</span>
                            <span className="sg-group-count">{group.players.length}</span>
                        </button>
                        {!isCollapsed && <div className="sg-group-body">{rowsFor(group.players)}</div>}
                    </section>
                );
            })}

            {!groups.length && <div className="scouting-empty">Nothing to group yet.</div>}

            {/* On a phone the unmatched players sit at the bottom of this same
                column; on a desktop they get a column of their own, and the
                view renders <UnmatchedList> instead. */}
            {unmatchedInline && unmatched.length > 0 && (
                <section className="sg-group sg-unmatched">
                    <div className="sg-group-header static">
                        <span className="sg-group-label">Unmatched</span>
                        <span className="sg-group-count">{unmatched.length}</span>
                    </div>
                    <div className="sg-group-body">{rowsFor(unmatched, true)}</div>
                </section>
            )}
        </div>
    );
}

/**
 * The players this grouping cannot place, in their own column.
 *
 * Not an error list — it is a worklist. Everyone here is missing the one field
 * the current grouping needs, which makes it the fastest way to find the gaps
 * worth filling in.
 */
export function UnmatchedList({ players, groupBy, selectedName, onSelect, tagFor }) {
    const { unmatched } = useMemo(() => groupPlayers(players, groupBy), [players, groupBy]);
    const what = { school: 'no school', round: 'unranked', position: 'no position' }[groupBy] ?? 'incomplete';

    return (
        <div className="sg-unmatched-panel">
            <div className="sg-panel-header">
                <span>Unmatched</span>
                <span className="sg-group-count">{unmatched.length}</span>
            </div>
            <div className="sg-panel-hint">{what}</div>
            <div className="sg-panel-body scroll-container">
                {unmatched.length === 0
                    ? <div className="scouting-empty">Nothing missing.</div>
                    : unmatched.map(p => (
                        <PlayerRow
                            key={`${p.name}|${p.position}`}
                            player={p}
                            selected={p.name === selectedName}
                            onSelect={onSelect}
                            tag={tagFor?.(p.name, p) ?? null}
                            showMissing
                        />
                    ))}
            </div>
        </div>
    );
}
