import React, { useState, useMemo } from 'react';
import CenterBoard from './CenterBoard';
import PlayerCard from './PlayerCard';
import UnrankedModal from './UnrankedModal';
import Menu from './Menu';
import usePlayerTags from '../hooks/usePlayerTags';
import { isDraftComplete, isUndraftedSigning } from '../utils/draftPhase';
import { getSessionTeam } from '../utils/appSettings';
import { csvField, parseCsvLine } from '../utils/csvUtils';

// UDFA reuses the exact board-grid Draft uses (see CenterBoard.jsx) — "who's
// left" is already what its default Normal view (isFocusMode=false) shows,
// since that filters to undrafted players.
//
// Signing goes through useDraftState's signUndrafted, NOT draftPlayer. It
// looked like the same action, but draftPlayer stamps the current pick number
// and advances the draft, so clicking a UDFA card mid-draft consumed a real
// pick and recorded the signing in draft order.
export default function UdfaView({ players, draftedPlayers, columnOrder, signUndrafted, currentPick, onInfoOpen }) {
    const [isUnrankedOpen, setIsUnrankedOpen] = useState(false);
    // Clicking a card used to sign him outright. A signing records a team and
    // a league-entry fact, and doing that on one click — during a broadcast,
    // on a board you are scrolling — is a keystroke away from a signing
    // nobody meant. It opens the same modal Draft uses, prefilled.
    const [signPlayer, setSignPlayer] = useState(null);
    const tagFor = usePlayerTags();
    const team = getSessionTeam();

    // OUR undrafted signings, not the league's. The counter read every team's,
    // so it climbed while you signed nobody — and the players it was counting
    // were nowhere on this screen, because the board shows who is LEFT.
    const signed = useMemo(
        () => draftedPlayers.filter(p => isUndraftedSigning(p) && (p.team ?? team) === team),
        [draftedPlayers, team],
    );

    const exportSigned = () => {
        const rows = [['name', 'position', 'school', 'team'].join(',')];
        signed.forEach(p => rows.push(
            [p.name, p.position ?? '', p.school ?? '', p.team ?? team].map(csvField).join(','),
        ));
        const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `udfa_${team.toLowerCase()}.csv`;
        a.click();
    };

    const importSigned = async (e) => {
        const file = e.target.files[0];
        if (!file || !signUndrafted) return;
        const lines = (await file.text()).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
        const hasHeader = header.includes('name');
        const cols = hasHeader ? header : ['name', 'position', 'school', 'team'];

        (hasHeader ? lines.slice(1) : lines).forEach(line => {
            const cells = parseCsvLine(line);
            const row = Object.fromEntries(cols.map((c, i) => [c, (cells[i] ?? '').trim()]));
            if (!row.name) return;
            // Straight through signUndrafted, the same path the button uses —
            // so an imported signing records the same facts as a typed one.
            signUndrafted({
                name: row.name,
                position: (row.position ?? '').toUpperCase(),
                school: row.school ?? '',
                arrival: 'UDFA',
                overallRank: 999,
                round: null,
                tier: null,
                isUnranked: true,
            });
        });
    };

    // A player is undrafted only once the draft is over, so signing is held
    // back until then. The board stays visible and browsable in the meantime —
    // seeing who is likely to go undrafted is exactly what you want beforehand
    // — but clicking a card can't record a signing.
    const draftComplete = isDraftComplete(currentPick);

    const updateRankingsParam = (newPath) => {
        const params = new URLSearchParams(window.location.search);
        params.set('rankings', newPath);
        window.location.href = `?${params.toString()}`;
    };
    const currentRankings = new URLSearchParams(window.location.search).get('rankings') || '';

    return (
        <div className="roster-view">
            <div className="top-panel">
                <div className="roster-brand">
                    <span className="roster-brand-name">UDFA</span>
                    <span className="roster-brand-sub">SIGN UNDRAFTED FREE AGENTS</span>
                </div>

                <div style={{ width: '20px' }} />

                <div className="board-switcher">
                    <span className="switcher-label">BOARD</span>
                    <div className="switcher-buttons">
                        <button
                            className={`switcher-btn ${!currentRankings || currentRankings.includes('rankings_consensus.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_consensus.csv`)}
                        >Consensus</button>
                        <button
                            className={`switcher-btn ${currentRankings.includes('rankings_dan.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_dan.csv`)}
                        >Dan</button>
                        <button
                            className={`switcher-btn ${currentRankings.includes('rankings_ryan.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_ryan.csv`)}
                        >Ryan</button>
                    </div>
                </div>

                <div style={{ flex: 1 }} />

                <div className="roster-counters">
                    <div className="roster-counter">
                        <div className="roster-counter-label">{team} UDFA SIGNED</div>
                        <div className="roster-counter-value">{signed.length}</div>
                    </div>
                </div>

                <div className="top-actions">
                    {!draftComplete && (
                        <span className="udfa-locked-note" title={`The draft is still on pick ${currentPick}`}>
                            Signing opens when the draft ends
                        </span>
                    )}
                    <button
                        onClick={() => setIsUnrankedOpen(true)}
                        className="action-pill"
                        disabled={!draftComplete}
                    >+ Sign Unranked Player</button>
                    <Menu items={[
                        { label: 'Export Signed UDFAs…', onClick: exportSigned, title: 'name, position, school, team' },
                        { label: 'Import Signed UDFAs…', file: { accept: '.csv', onFile: importSigned }, title: 'Signs everyone in the file, the same way the button does' },
                    ]} />
                </div>
            </div>
            <div className="udfa-body">
            <CenterBoard
                players={players}
                onAction={draftComplete ? setSignPlayer : undefined}
                columnOrder={columnOrder}
                isFocusMode={false}
                onInfoOpen={onInfoOpen}
                tagFor={tagFor}
            />

            <div className="udfa-signed-panel">
                <div className="sg-panel-header">
                    <span>Signed</span>
                    <span className="sg-group-count">{signed.length}</span>
                </div>
                <div className="sg-panel-hint">{team} · undrafted</div>
                <div className="sg-panel-body scroll-container">
                    {signed.length === 0
                        ? <div className="scouting-empty">Nobody signed yet.</div>
                        : signed.map(p => (
                            <div key={`${p.name}|${p.position}`} className="udfa-signed-card">
                                <PlayerCard
                                    player={p}
                                    onClick={() => onInfoOpen?.(p)}
                                    onInfoOpen={onInfoOpen}
                                    tag={tagFor?.(p.name, p) ?? null}
                                    alwaysClickable
                                    hideDraftedStyle
                                    noStrikethrough
                                    slim
                                />
                            </div>
                        ))}
                </div>
            </div>
            </div>

            <UnrankedModal
                key={`udfa-sign-${signPlayer?.name ?? 'none'}`}
                isOpen={!!signPlayer}
                onClose={() => setSignPlayer(null)}
                onDraft={signUndrafted}
                mode="postdraft"
                initialPlayer={signPlayer}
            />

            <UnrankedModal
                key={`udfa-unranked-${isUnrankedOpen}`}
                isOpen={isUnrankedOpen}
                onClose={() => setIsUnrankedOpen(false)}
                onDraft={signUndrafted}
                mode="postdraft"
            />
        </div>
    );
}
