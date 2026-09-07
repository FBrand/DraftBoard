import React, { useState } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';
import { resolve as resolvePlayer, byId } from '../utils/playerRegistry';

// mode: 'draft' | 'roster' | 'postdraft'
// 'draft'     → draft board during the draft: Name+Pos, Draft
// 'roster'    → roster view, whenever: how a player joins THIS team, which is
//               by signing or by trade. Signing a UDFA belongs to the UDFA
//               stage; offering it here made the roster modal look like that
//               stage rather than this one.
// 'postdraft' → the UDFA stage: Sign UDFA / Invite. Deliberately NOT "Sign
//               FA" — this is the undrafted stage, and a veteran free agent
//               signed here would be recorded as though he had just come out
//               of college. Signing a veteran belongs to Roster, which has it.
// 'candidate' → free agency: a player you might acquire, and HOW you would
//               acquire him, because that is the whole question at this stage
//               — a free agent costs money and a trade costs picks. The verb
//               differs from 'roster': FA records who you are considering, it
//               does not sign anybody.
const UnrankedModal = ({ isOpen, onClose, onDraft, mode = 'draft', initialPlayer = null }) => {
    const [name, setName] = useState(() => initialPlayer?.name || '');
    const [position, setPosition] = useState(() => initialPlayer?.position || '');
    // School is part of the identity — two players sharing a name are told
    // apart by position OR school (see nameMatcher). Collecting it here is
    // also the only chance: nothing downstream can infer where he played.
    // The draft pool is built from the rankings files, which carry no school
    // column — but the registry has one for nearly everybody, seeded from the
    // draft file and the league. Not prefilling it made you retype something
    // the app already knew.
    const [school, setSchool] = useState(() => {
        if (initialPlayer?.school) return initialPlayer.school;
        if (!initialPlayer?.name) return '';
        const id = initialPlayer.id
            ?? resolvePlayer({ name: initialPlayer.name }, { create: false });
        return (id && byId(id)?.school) || '';
    });
    const [team, setTeam] = useState(() => initialPlayer?.team || 'KC');
    // Where he came from. Only means anything for a move between clubs — a
    // draft pick and a UDFA are entering the league, not leaving somewhere.
    const [previousTeam, setPreviousTeam] = useState(() => initialPlayer?.previousTeam || '');
    // How he entered the league. A player you sign or trade for got here some
    // other year, and nothing else can tell us which: the roster file carries
    // it for players already on the roster, but somebody added by hand has no
    // suffix to read it from, so his card said "????" for good.
    const [draftYear, setDraftYear] = useState(() => initialPlayer?.draftYear || '');
    const [draftRound, setDraftRound] = useState(() => initialPlayer?.draftRound || '');
    useEscapeKey(onClose, isOpen);

    if (!isOpen) return null;

    const disabled = !name || !position;

    // How he arrived is passed alongside the name, not inside it. It used to
    // be appended as ":FA" — and the name is the identity key, so that made
    // one player two.
    const MOVED_CLUBS = new Set(['FA', 'TR']);

    const submit = (suffix = '', clubOverride) => {
        if (disabled) return;
        const club = clubOverride !== undefined ? clubOverride : team;
        onDraft({
            name: name.trim(),
            position: position.toUpperCase(),
            ...(school.trim() ? { school: school.trim() } : {}),
            arrival: suffix || null,
            // Blank is meaningful in the UDFA stage: signed, but not yet
            // assigned to a club. Passing '' says that; omitting the key
            // would let the caller fall back to the session team.
            ...(club.trim() ? { team: club.trim().toUpperCase() } : (mode === 'postdraft' ? { team: '' } : {})),
            ...(MOVED_CLUBS.has(suffix) && previousTeam.trim()
                ? { previousTeam: previousTeam.trim().toUpperCase() }
                : {}),
            ...(draftYear ? { draftYear: parseInt(draftYear, 10) } : {}),
            ...(draftRound ? { draftRound: parseInt(draftRound, 10) } : {}),
            overallRank: 999,
            round: null,
            tier: null,
            isUnranked: true,
        });
        onClose();
    };

    const titles = { draft: 'Draft Unranked Player', roster: 'Add Player', postdraft: 'Sign Player', candidate: 'Add Candidate' };

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
                    <div className="form-group">
                        <label>School</label>
                        <input type="text" value={school} onChange={e => setSchool(e.target.value)}
                            placeholder="e.g. Indiana" className="text-input" />
                    </div>
                    {(mode === 'roster' || mode === 'candidate') && (
                        <div className="form-row-pair">
                            <div className="form-group">
                                <label>Draft Year</label>
                                <input type="number" min="1936" value={draftYear}
                                    onChange={e => setDraftYear(e.target.value)}
                                    placeholder="e.g. 2024" className="text-input" />
                            </div>
                            <div className="form-group">
                                <label>Round</label>
                                <input type="number" min="1" value={draftRound}
                                    onChange={e => setDraftRound(e.target.value)}
                                    placeholder="e.g. 3 — blank if undrafted" className="text-input" />
                            </div>
                        </div>
                    )}
                    {/* A signing or a trade comes FROM somewhere and goes TO
                        somewhere. A draft pick and a UDFA are ENTERING the
                        league: there is no prior club to have come from, and
                        the club he joins is the session team either way. His
                        college is `school`, which is a different question.

                        This condition used to read `mode !== 'draft'`, which
                        excluded the draft and nothing else — so the UDFA stage
                        asked for a previous team the player cannot have, while
                        the comment right here said it shouldn't. */}
                    {mode === 'postdraft' && (
                        <div className="form-group">
                            <label>Team</label>
                            <input type="text" value={team} onChange={e => setTeam(e.target.value)}
                                placeholder="KC — or leave blank: signed, no team yet"
                                className="text-input" />
                        </div>
                    )}
                    {(mode === 'roster' || mode === 'candidate') && (
                        <>
                            <div className="form-group">
                                <label>Previous Team</label>
                                <input type="text" value={previousTeam}
                                    onChange={e => setPreviousTeam(e.target.value)}
                                    placeholder="e.g. LV — where he came from" className="text-input" />
                            </div>
                            <div className="form-group">
                                <label>New Team</label>
                                <input type="text" value={team} onChange={e => setTeam(e.target.value)}
                                    placeholder="e.g. KC" className="text-input" />
                            </div>
                        </>
                    )}
                    <div className="modal-actions" style={{ marginTop: 20 }}>
                        {mode === 'draft' && (
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button type="button" className="action-button secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
                                <button type="submit" className="action-button primary" style={{ flex: 1 }} disabled={disabled}>Draft</button>
                            </div>
                        )}
                        {mode === 'candidate' && (
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button type="button" className="action-button primary" style={{ flex: 1 }} disabled={disabled} onClick={() => submit('FA')}>Add as FA Target</button>
                                <button type="button" className="action-button secondary" style={{ flex: 1 }} disabled={disabled} onClick={() => submit('TR')}>Add as Trade Target</button>
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
                                <button type="button" className="action-button primary" style={{ flex: 1, background: 'var(--chiefs-gold)', color: '#000' }} disabled={disabled} onClick={() => submit('UDFA')}>Sign UDFA</button>
                                <button type="button" className="action-button secondary" style={{ flex: 1 }} disabled={disabled}
                                    title="Signed, but not assigned to a club yet"
                                    onClick={() => { setTeam(''); submit('UDFA', ''); }}>Sign · No Team</button>
                                <button type="button" className="action-button secondary" style={{ flex: 1 }} disabled={disabled} onClick={() => submit('INV')}>Minicamp Invite</button>
                            </div>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

export default UnrankedModal;
