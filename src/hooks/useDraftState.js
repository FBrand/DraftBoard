import { useState, useEffect, useCallback } from 'react';
import { parseRankings, parsePicks } from '../utils/dataParser';
import { openBoards, boardBySlug } from '../utils/boardRegistry';
import { shouldSeed } from '../utils/appInit';
import { highestDraftPick, isUndraftedSigning, roundForPick, lastDraftPick } from '../utils/draftPhase';
import { TEAM_CONFIG, DRAFT_YEAR } from '../constants';
import { resolve as resolvePlayer, resolveAll, setFacts, setFactsMany, rename as renamePlayer } from '../utils/playerRegistry';
import { getSessionTeam as sessionTeam } from '../utils/appSettings';

/**
 * Writes what a completed draft says about the players in it.
 *
 * A draft read from DraftBoard_Picks.csv never passes through draftPlayer, so
 * nothing recorded who took whom — the cards showed no team, no pick and no
 * round even though the draft was over. Resolved in one batch, because this
 * runs over every pick in the draft.
 */
function recordDraftFacts(drafted) {
    if (!drafted?.length) return;
    const ids = resolveAll(drafted.map(p => ({ name: p.name, position: p.position, school: p.school })));

    // One write for the whole draft. Per player, this was 639 serialisations
    // of the entire players collection on every cold start.
    const updates = [];
    drafted.forEach((p, i) => {
        const id = ids[i];
        if (!id) return;

        if (isUndraftedSigning(p)) {
            updates.push({ id, patch: { isUdfa: true, draftYear: DRAFT_YEAR, team: p.team || null } });
            return;
        }

        const pick = Number(p.pickNumber);
        if (!Number.isFinite(pick)) return;
        updates.push({
            id,
            patch: {
                isUdfa: false,
                draftYear: DRAFT_YEAR,
                draftPick: pick,
                draftRound: roundForPick(pick),
                team: p.team || null,
            },
        });
    });
    setFactsMany(updates);
}
import { findMatchingPlayerIndex, buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';

const DRAFT_STORAGE_KEY = 'nfl_draft_board_state';
const IS_LIVE_SYNC_KEY = 'nfl_draft_live_sync';

const chimeAudio = new Audio(`${import.meta.env.BASE_URL}nfl-draft-chime.mp3`);
chimeAudio.volume = 0.4;

const chopAudio = new Audio(`${import.meta.env.BASE_URL}chiefs_tomahawk_chop.mp3`);
chopAudio.volume = 0.6;

export const useDraftState = () => {
    const [players, setPlayers] = useState([]);
    const [ourPicksLeft, setOurPicksLeft] = useState([]);
    const [draftedPlayers, setDraftedPlayers] = useState([]);
    const [yourPicks, setYourPicks] = useState([]);
    const [currentPick, setCurrentPick] = useState(1);
    const [remotePicks, setRemotePicks] = useState([]);
    const [history, setHistory] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isLiveSync, setIsLiveSync] = useState(() => {
        return localStorage.getItem(IS_LIVE_SYNC_KEY) === 'true';
    });
    const [canLiveSync, setCanLiveSync] = useState(false);
    const [columnOrder, setColumnOrder] = useState([]);

    const triggerChime = useCallback(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.has('chime') && params.get('chime') !== 'false') {
            chimeAudio.currentTime = 0; // Rewind in case it's currently sweeping
            chimeAudio.play().catch(e => console.warn("Chime auto-play blocked by browser.", e));
        }
    }, []);

    const triggerChop = useCallback(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.has('chime') && params.get('chime') !== 'false') {
            chopAudio.currentTime = 0;
            chopAudio.play().catch(e => console.warn("Chop auto-play blocked by browser.", e));
        }
    }, []);

    // Play Chop when our turn comes up (with 5s delay)
    useEffect(() => {
        if (!loading && ourPicksLeft.includes(currentPick)) {
            const timer = setTimeout(() => {
                triggerChop();
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [currentPick, ourPicksLeft, loading, triggerChop]);

    // Check if live sync module is available AND enabled via query param
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const syncEnabled = params.get('sync') === 'true';

        const checkAvailability = async () => {
            if (import.meta.env.VITE_ENABLE_SYNC) {
                const modules = import.meta.glob('../services/ESPNProvider.js');
                const hasModule = Object.keys(modules).length > 0;

                if (hasModule && syncEnabled) {
                    setCanLiveSync(true);
                } else {
                    setCanLiveSync(false);
                    setIsLiveSync(false);
                }
            } else {
                setCanLiveSync(false);
                setIsLiveSync(false);
            }
        };

        checkAvailability();
    }, []);

    const saveHistory = useCallback(() => {
        setHistory({ players, ourPicksLeft, currentPick, draftedPlayers, yourPicks });
    }, [players, ourPicksLeft, currentPick, draftedPlayers, yourPicks]);

    // Initial load
    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const base = import.meta.env.BASE_URL;
                const params = new URLSearchParams(window.location.search);
                // A ?rankings= link is the normal way to hand somebody a
                // board, which means it is also the normal way to hand
                // somebody a TYPO. One double-encoded link — %252F where %2F
                // was meant — fetched a path that 404s, and because fetch does
                // not throw on 404 the app parsed GitHub's error page as a
                // rankings file, crashed on the first row, and rendered a
                // white screen. Someone was told "it's fixed, try again",
                // clicked that, and saw nothing twice.
                const fallback = `${base}rankings_consensus.csv`;

                // One switch, not two. A board used to be selectable by
                // ?board= (its name) or ?rankings= (a file path), and only the
                // second actually worked on this view — so the name did
                // nothing while the path quietly did the work, and a board
                // whose file was renamed, or one made in the app, could not be
                // linked to at all. The path is gone; the board knows its own
                // file.
                await openBoards();
                const slug = params.get('board');
                const board = slug ? boardBySlug(slug) : null;
                const fromBoard = board?.rankingsFile ? `${base}${board.rankingsFile}` : null;
                const candidates = [fromBoard, fallback].filter(Boolean);

                // First candidate that actually answers. Falling back to the
                // shipped board beats showing nothing: a wrong board is
                // obvious and recoverable, a blank page looks broken.
                let rankingsRes = null;
                for (const url of candidates) {
                    try {
                        const res = await fetch(url);
                        if (res.ok) { rankingsRes = res; break; }
                    } catch { /* try the next one */ }
                }

                const [picksRes, columnsRes, preloadRes] = await Promise.all([
                    fetch(`${base}picks.txt`),
                    fetch(`${base}columns.txt`),
                    fetch(`${base}DraftBoard_Picks.csv`).catch(() => null)
                ]);

                const rankingsText = rankingsRes ? await rankingsRes.text() : '';
                const picksText = await picksRes.text();
                const columnsText = await columnsRes.text().catch(() => "");
                const parsedPositions = columnsText.split(',').map(p => p.trim()).filter(p => p);
                setColumnOrder(parsedPositions);

                const parsedPlayers = parseRankings(rankingsText) || [];
                const parsedOurPicks = parsePicks(picksText) || [];

                const savedState = localStorage.getItem(DRAFT_STORAGE_KEY);

                let seedDrafted = [];
                let seedKCLeft = parsedOurPicks;

                // If no saved localStorage state but CSV exists, use CSV as seed.
                // Skipped in "clean" mode — see utils/appInit.js.
                if (!savedState && shouldSeed() && preloadRes && preloadRes.ok) {
                    const csvText = await preloadRes.text();
                    try {
                        const { deserializeDraftState } = await import('../utils/sessionSerializer');
                        const importedState = deserializeDraftState(csvText);
                        if (importedState.draftedPlayers.length > 0 || importedState.ourPicksLeft.length > 0) {
                            seedDrafted = importedState.draftedPlayers;
                            if (importedState.ourPicksLeft.length > 0) {
                                seedKCLeft = importedState.ourPicksLeft;
                            }
                        }
                    } catch (e) { console.warn("Failed to parse preloaded CSV:", e); }
                }

                if (savedState || seedDrafted.length > 0 || seedKCLeft !== parsedOurPicks) {
                    try {
                        let parsedState = {};
                        if (savedState) {
                            parsedState = JSON.parse(savedState);
                        }
                        const savedDrafted = Array.isArray(parsedState.draftedPlayers) ? parsedState.draftedPlayers : seedDrafted;
                        const savedKCLeft = Array.isArray(parsedState.ourPicksLeft) ? parsedState.ourPicksLeft : seedKCLeft;

                        // 1. Reconcile fresh parsedPlayers with saved history (Board View)
                        const savedDraftedIndex = buildNameIndex(savedDrafted);
                        const reconciledPlayers = parsedPlayers.map(p => {
                            const matchIdx = findMatchingIndex(p.name, savedDraftedIndex);
                            if (matchIdx !== -1) {
                                const match = savedDrafted[matchIdx];
                                return {
                                    ...p,
                                    drafted: true,
                                    pickNumber: match.pickNumber,
                                    team: match.team,
                                    draftedByUs: savedKCLeft.includes(match.pickNumber)
                                };
                            }
                            return p;
                        });

                        // 2. Re-enrich saved draft history (Right Panel View) with fresh metadata
                        // NOTE: use sd.draftedByUs (persisted value) — savedKCLeft only has *remaining* picks,
                        // so re-computing from it would always yield false for already-drafted players.
                        const parsedPlayersIndex = buildNameIndex(parsedPlayers);
                        const enrichedDrafted = savedDrafted.map(sd => {
                            const matchIdx = findMatchingIndex(sd.name, parsedPlayersIndex);
                            const draftedByUs = sd.draftedByUs === true || sd.team === TEAM_CONFIG.abbreviation; // Trust persisted or evaluate from CSV team string
                            if (matchIdx !== -1) {
                                const updatedMetadata = parsedPlayers[matchIdx];
                                return {
                                    ...updatedMetadata,
                                    pickNumber: sd.pickNumber,
                                    team: sd.team,
                                    drafted: true,
                                    draftedByUs
                                };
                            }
                            return { ...sd, draftedByUs };
                        });

                        setPlayers(reconciledPlayers);
                        setOurPicksLeft(savedKCLeft);
                        const pickFallback = savedState ? parsedState.currentPick : undefined;
                        setCurrentPick(typeof pickFallback === 'number' ? pickFallback : 1);
                        setDraftedPlayers(enrichedDrafted);

                        // yourPicks = all enriched entries where draftedByUs is persisted as true
                        const enrichedYourPicks = enrichedDrafted.filter(p => p.draftedByUs);
                        setYourPicks(enrichedYourPicks);

                        // A draft loaded from file never passed through
                        // draftPlayer, so nothing had recorded what it says
                        // about these players. Their cards showed no team, no
                        // pick and no round despite the draft being complete.
                        recordDraftFacts(enrichedDrafted);

                        setRemotePicks(savedState && Array.isArray(parsedState.remotePicks) ? parsedState.remotePicks : []);

                        // Seed the current pick from the highest recorded one.
                        // UDFA rows carry the literal 'UDFA' rather than a
                        // number and are skipped — one of them in a Math.max
                        // used to turn currentPick into NaN, which read as
                        // 'draft not started' and locked the UDFA stage on a
                        // completed draft (see utils/draftPhase.js).
                        if (!savedState && enrichedDrafted.length > 0) {
                            setCurrentPick(highestDraftPick(enrichedDrafted) + 1);
                        }
                    } catch {
                        console.warn("Corrupted localStorage, using fresh data");
                        setPlayers(parsedPlayers);
                        setOurPicksLeft(parsedOurPicks);
                    }
                } else {
                    setPlayers(parsedPlayers);
                    setOurPicksLeft(parsedOurPicks);
                }
            } catch (error) {
                console.error("Error loading data:", error);
            } finally {
                setLoading(false);
            }
        };

        loadInitialData();
    }, []);

    // Persist State
    useEffect(() => {
        if (!loading) {
            const state = { players, ourPicksLeft, currentPick, draftedPlayers, yourPicks, remotePicks };
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(state));
        }
    }, [players, ourPicksLeft, currentPick, draftedPlayers, yourPicks, remotePicks, loading]);

    // Persist Live Sync setting
    useEffect(() => {
        localStorage.setItem(IS_LIVE_SYNC_KEY, isLiveSync);
    }, [isLiveSync]);

    const draftPlayer = useCallback((player) => {
        if (player.drafted) return;
        saveHistory();

        const pickNumber = currentPick;
        const isOurPick = ourPicksLeft.includes(pickNumber);

        // Infer team from remotePicks (if we have the draft order loaded)
        // Use robust Number conversion to avoid type mismatch (string vs number)
        const remoteMatch = remotePicks.find(rp =>
            (rp.overall !== undefined && Number(rp.overall) === Number(pickNumber)) ||
            (rp.number !== undefined && Number(rp.number) === Number(pickNumber))
        );

        const team = isOurPick ? TEAM_CONFIG.abbreviation : (remoteMatch?.team || '-');

        const matchIdx = findMatchingPlayerIndex(player.name, players);
        
        setPlayers(prev => prev.map((p, idx) =>
            idx === matchIdx
                ? { ...p, drafted: true, pickNumber, draftedByUs: isOurPick, team }
                : p
        ));

        const draftedPlayer = { ...player, drafted: true, pickNumber, draftedByUs: isOurPick, team };
        setDraftedPlayers(prev => [...prev, draftedPlayer]);

        if (isOurPick) {
            setYourPicks(prev => [...prev, draftedPlayer]);
            // Remove this pick from ourPicksLeft since it's been used
            setOurPicksLeft(prev => prev.filter(pk => pk !== pickNumber));
        }

        // A pick is a fact about the player, not an opinion, so it goes on his
        // record rather than only into this session's draft state. The round
        // comes from the stated boundaries (constants.DRAFT_ROUND_ENDS), not
        // from dividing the pick number, which compensatory picks break.
        const id = resolvePlayer({ name: player.name, position: player.position, school: player.school });
        if (id) {
            setFacts(id, {
                isUdfa: false,
                draftYear: DRAFT_YEAR,
                draftPick: pickNumber,
                draftRound: roundForPick(pickNumber),
                team,
            });
        }

        triggerChime();
        setCurrentPick(prev => prev + 1);
    }, [currentPick, ourPicksLeft, remotePicks, players, saveHistory, triggerChime]);

    /**
     * Signs an undrafted free agent. Deliberately NOT draftPlayer: that stamps
     * the current pick number on the player and advances the draft, so signing
     * from the UDFA board consumed a real pick and recorded the signing as, say,
     * pick 10. UDFA signings sit past the end of the draft (258+) — the number
     * is an identifier, not a pick — and `currentPick` never moves.
     */
    const signUndrafted = useCallback((player) => {
        if (player.drafted) return;
        saveHistory();

        // Signings are numbered on from the end of the draft. UDFA rows read
        // from the CSV carry a label instead of a number and contribute
        // nothing to the count, which is fine — the number only has to be
        // unique and after the draft.
        const lastUdfaPick = draftedPlayers.reduce((max, p) => {
            if (!isUndraftedSigning(p)) return max;
            const n = Number(p.pickNumber);
            return Number.isFinite(n) ? Math.max(max, n) : max;
        }, lastDraftPick());
        const pickNumber = lastUdfaPick + 1;
        // An explicitly empty team is "signed, no club yet" and must survive;
        // only an absent key falls back to whose offseason this is.
        const club = player.team === undefined ? sessionTeam() : (player.team || null);
        const signed = { ...player, drafted: true, pickNumber, draftedByUs: club === sessionTeam(), team: club };

        const matchIdx = findMatchingPlayerIndex(player.name, players);
        setPlayers(prev => prev.map((p, idx) => (idx === matchIdx ? { ...p, ...signed } : p)));
        setDraftedPlayers(prev => [...prev, signed]);

        // Going undrafted is just as much a league-entry fact as being picked.
        const id = resolvePlayer({ name: player.name, position: player.position, school: player.school });
        if (id) setFacts(id, { isUdfa: true, draftYear: DRAFT_YEAR, draftPick: null, draftRound: null, team: club });
    }, [draftedPlayers, players, saveHistory]);

    const undoAction = useCallback(() => {
        if (!history) return;
        setPlayers(history.players);
        setOurPicksLeft(history.ourPicksLeft);
        setCurrentPick(history.currentPick);
        setDraftedPlayers(history.draftedPlayers);
        setYourPicks(history.yourPicks);
        setHistory(null);
    }, [history]);

    const updateOurPicks = useCallback((newPicks) => {
        saveHistory();
        setOurPicksLeft(newPicks);
    }, [saveHistory]);

    // Clears the draft only, and stops the shipped picks file re-seeding it on
    // the way back up. (This used to write the literal string 'empty' into the
    // state key, which worked only because it is truthy enough to skip seeding
    // and then throws inside the JSON.parse try/catch.)
    const resetDraft = useCallback(() => {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ draftedPlayers: [], ourPicksLeft: [] }));
        window.location.reload();
    }, []);

    const importDraftState = useCallback((importedState) => {
        saveHistory();
        const { draftedPlayers: importedDrafted, ourPicksLeft: importedKCLeft } = importedState;

        if (Array.isArray(importedKCLeft)) {
            setOurPicksLeft(importedKCLeft);
        }

        // Enrich imported player objects with ranking metadata if available.
        // draftedByUs: trust the imported flag (importedKCLeft is *remaining* picks, not historical).
        // The CSV import sets draftedByUs on each entry; fall back to checking if team === KC.
        const playersIndex = buildNameIndex(players);
        const enrichedDrafted = importedDrafted.map(id => {
            const matchIdx = findMatchingIndex(id.name, playersIndex);
            const draftedByUs = id.draftedByUs === true || id.team === TEAM_CONFIG.abbreviation;
            if (matchIdx !== -1) {
                const playerFromRankings = players[matchIdx];
                return {
                    ...playerFromRankings,
                    pickNumber: id.pickNumber,
                    team: id.team,
                    drafted: true,
                    draftedByUs
                };
            }
            return { ...id, draftedByUs };
        });

        setDraftedPlayers(enrichedDrafted);

        // Update players availability
        const enrichedDraftedIndex = buildNameIndex(enrichedDrafted);
        setPlayers(prev => prev.map(p => {
            const matchIdx = findMatchingIndex(p.name, enrichedDraftedIndex);
            if (matchIdx !== -1) {
                const match = enrichedDrafted[matchIdx];
                return {
                    ...p,
                    drafted: true,
                    pickNumber: match.pickNumber,
                    team: match.team,
                    draftedByUs: match.draftedByUs
                };
            }
            return { ...p, drafted: false, pickNumber: null, team: null, draftedByUs: false };
        }));

        // yourPicks: all that were drafted by us
        const newYourPicks = enrichedDrafted.filter(dp => dp.draftedByUs);
        setYourPicks(newYourPicks);

        // Update current pick
        const lastPick = enrichedDrafted.reduce((max, p) => Math.max(max, p.pickNumber), 0);
        setCurrentPick(lastPick + 1);
    }, [saveHistory, players]); // Added players to dependency

    // Live Sync Polling
    useEffect(() => {
        if (!isLiveSync || loading) return;

        let provider = null;
        const poll = async () => {
            if (!import.meta.env.VITE_ENABLE_SYNC) return;

            // Safe discovery via import.meta.glob — prevents Vite analysis errors if folder missing
            if (!provider) {
                const modules = import.meta.glob('../services/ESPNProvider.js');
                const modulePath = '../services/ESPNProvider.js';

                if (modules[modulePath]) {
                    try {
                        const mod = await modules[modulePath]();
                        provider = new mod.ESPNProvider();
                    } catch (err) {
                        console.warn('Live sync unavailable: discovery failed', err);
                        return;
                    }
                } else {
                    console.warn('Live sync unavailable: provider module not found');
                    return;
                }
            }
            const picks = await provider.fetchDraftData();
            if (!picks || picks.length === 0) return;

            setRemotePicks(picks);

            setPlayers(prevPlayers => {
                if (!Array.isArray(prevPlayers)) return [];
                let updatedPlayers = [...prevPlayers];
                let updatedDrafted = [...draftedPlayers];
                let updatedYourPicks = [...yourPicks];
                let updatedKCLeft = [...ourPicksLeft];
                let maxOverall = currentPick;
                let changed = false;
                // updatedPlayers only has existing entries replaced in place below
                // (never grown), so its name index stays valid for the whole loop.
                const updatedPlayersIndex = buildNameIndex(updatedPlayers);

                // 1. Update pick assignments (Trades)
                const chiefsPicks = picks
                    .filter(p => p.team === TEAM_CONFIG.abbreviation && !p.player)
                    .map(p => p.overall);

                if (JSON.stringify([...chiefsPicks].sort((a, b) => a - b)) !== JSON.stringify([...updatedKCLeft].sort((a, b) => a - b))) {
                    setOurPicksLeft(chiefsPicks);
                    changed = true;
                }

                // 2. Process picks with players
                picks.forEach(rp => {
                    if (rp.player) {
                        const isOurPick = (rp.team === TEAM_CONFIG.abbreviation);

                        const playerIndex = findMatchingIndex(rp.player.name, updatedPlayersIndex);

                        if (playerIndex !== -1) {
                            const existingPlayer = updatedPlayers[playerIndex];

                            if (!existingPlayer.drafted) {
                                // Newly drafted ranked player
                                const player = { ...existingPlayer };
                                player.drafted = true;
                                player.pickNumber = rp.overall;
                                player.draftedByUs = isOurPick;
                                player.team = rp.team;

                                updatedPlayers[playerIndex] = player;
                                updatedDrafted.push(player);
                                if (player.draftedByUs) {
                                    updatedYourPicks.push(player);
                                }
                                changed = true;
                            } else {
                                // Already drafted. Check for trade updates
                                if (existingPlayer.team !== rp.team || existingPlayer.pickNumber !== rp.overall) {
                                    const updatedP = { ...existingPlayer, team: rp.team, pickNumber: rp.overall, draftedByUs: isOurPick };
                                    updatedPlayers[playerIndex] = updatedP;

                                    const draftIdx = updatedDrafted.findIndex(dp => dp.name === existingPlayer.name);
                                    if (draftIdx !== -1) updatedDrafted[draftIdx] = updatedP;

                                    const yourIdx = updatedYourPicks.findIndex(dp => dp.name === existingPlayer.name);
                                    if (isOurPick && yourIdx === -1) {
                                        updatedYourPicks.push(updatedP);
                                    } else if (!isOurPick && yourIdx !== -1) {
                                        updatedYourPicks.splice(yourIdx, 1);
                                    }
                                    changed = true;
                                }
                            }
                        } else {
                            // Player NOT found on rankings board (Unranked)
                            const unrankedIdx = findMatchingPlayerIndex(rp.player.name, updatedDrafted);

                            if (unrankedIdx === -1) {
                                // New unranked player via live sync
                                const newUnranked = {
                                    name: rp.player.name,
                                    position: "URA", // Unranked Placeholder
                                    drafted: true,
                                    pickNumber: rp.overall,
                                    draftedByUs: isOurPick,
                                    team: rp.team
                                };
                                updatedDrafted.push(newUnranked);
                                if (isOurPick) {
                                    updatedYourPicks.push(newUnranked);
                                }
                                changed = true;
                            } else {
                                // Existing unranked player. Check for trade updates
                                const existingUnranked = updatedDrafted[unrankedIdx];
                                if (existingUnranked.team !== rp.team || existingUnranked.pickNumber !== rp.overall) {
                                    const updatedUnranked = { ...existingUnranked, team: rp.team, pickNumber: rp.overall, draftedByUs: isOurPick };
                                    updatedDrafted[unrankedIdx] = updatedUnranked;

                                    const yourIdx = updatedYourPicks.findIndex(dp => dp.name === existingUnranked.name);
                                    if (isOurPick && yourIdx === -1) {
                                        updatedYourPicks.push(updatedUnranked);
                                    } else if (!isOurPick && yourIdx !== -1) {
                                        updatedYourPicks.splice(yourIdx, 1);
                                    }
                                    changed = true;
                                }
                            }
                        }

                        if (rp.overall >= maxOverall) {
                            maxOverall = rp.overall + 1;
                        }
                    }
                });

                if (maxOverall > currentPick) {
                    changed = true;
                    // Note: setPlayers runs synchronously inside the interval, but since React 18 strict mode
                    // could run it twice, we should technically keep side effects out. However, auto-play policies
                    // will block silent duplicates anyway, and it's safe enough for a fast tick.
                    triggerChime();
                }

                if (changed) {
                    setDraftedPlayers(updatedDrafted);
                    setYourPicks(updatedYourPicks);
                    setCurrentPick(maxOverall);
                    return updatedPlayers;
                }
                return prevPlayers;
            });
        };

        poll();
        const interval = setInterval(poll, 30000);
        return () => clearInterval(interval);
    }, [isLiveSync, loading, draftedPlayers, yourPicks, ourPicksLeft, currentPick, triggerChime]);

    /**
     * Moves a player into a tier on the draft board.
     *
     * The board is editable during a draft for the same reason Scouting's is:
     * a player rises or falls on Friday night and the board has to say so
     * before you are on the clock. It writes round and tier on the pool, which
     * the existing persistence effect saves — no separate store, so the board
     * you edit is the board you drafted from.
     */
    const placePlayer = useCallback((player, target) => {
        // CenterBoard hands over the cell's own {round, tier, position}. This
        // used to call parseTier on it as though it were the fused "1.2"
        // label, which parsed "[object Object]", produced no round, and
        // returned — so the board looked editable and moved nothing.
        const round = target?.round ?? null;
        const tier = target?.tier ?? null;
        if (round == null) return;

        const base = player.position.split('.', 1)[0];
        const movedColumn = target.position && target.position !== base;
        // Keep the alignment when he stays in his own column ("WR.Z" is still
        // a WR); a move to another column replaces it, because the alignment
        // belonged to the old position.
        const position = movedColumn ? target.position : player.position;

        setPlayers(prev => {
            const moved = { ...player, round, tier, position };
            const rest = prev.filter(p => !(p.name === player.name && p.position === player.position));
            // Within-cell order is the pool's own order — the board renders a
            // cell's players in the order it receives them — so ordering means
            // splicing him in ahead of the man he was dropped on.
            if (!target.before) {
                return prev.map(p => (
                    p.name === player.name && p.position === player.position ? moved : p
                ));
            }
            const at = rest.findIndex(p => p.name === target.before.name && p.position === target.before.position);
            if (at === -1) return [...rest, moved];
            return [...rest.slice(0, at), moved, ...rest.slice(at)];
        });

        // Position is base data — true on every board — so a correction has to
        // reach the record, not just this pool.
        if (movedColumn) {
            const id = resolvePlayer({ name: player.name }, { create: false });
            if (id) renamePlayer(id, { position: target.position });
        }
    }, []);

    return {
        players: players || [],
        ourPicksLeft: ourPicksLeft || [],
        draftedPlayers: draftedPlayers || [],
        yourPicks: yourPicks || [],
        currentPick,
        remotePicks: remotePicks || [],
        loading,
        isLiveSync,
        canLiveSync,
        columnOrder,
        toggleLiveSync: () => setIsLiveSync(prev => !prev),
        draftPlayer,
        signUndrafted,
        undoAction,
        updateOurPicks,
        resetDraft,
        importDraftState,
        placePlayer
    };
};

export default useDraftState;
