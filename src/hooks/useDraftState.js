import { useState, useEffect, useCallback } from 'react';
import { parseRankings, parsePicks } from '../utils/dataParser';
import { TEAM_CONFIG } from '../constants';
import { findMatchingPlayerIndex } from '../utils/nameMatcher';

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
        setHistory(prev => ({ players, ourPicksLeft, currentPick, draftedPlayers, yourPicks }));
    }, [players, ourPicksLeft, currentPick, draftedPlayers, yourPicks]);

    // Initial load
    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const base = import.meta.env.BASE_URL;
                const params = new URLSearchParams(window.location.search);
                const rankingsUrl = params.get('rankings') || `${base}rankings_consensus.csv`;

                const [rankingsRes, picksRes, columnsRes, preloadRes] = await Promise.all([
                    fetch(rankingsUrl),
                    fetch(`${base}picks.txt`),
                    fetch(`${base}columns.txt`),
                    fetch(`${base}DraftBoard_Picks.csv`).catch(() => null)
                ]);

                const rankingsText = await rankingsRes.text();
                const picksText = await picksRes.text();
                const columnsText = await columnsRes.text().catch(() => "");
                const parsedPositions = columnsText.split(',').map(p => p.trim()).filter(p => p);
                setColumnOrder(parsedPositions);

                const parsedPlayers = parseRankings(rankingsText) || [];
                const parsedOurPicks = parsePicks(picksText) || [];

                const savedState = localStorage.getItem(DRAFT_STORAGE_KEY);
                
                let seedDrafted = [];
                let seedKCLeft = parsedOurPicks;

                // If no saved localStorage state but CSV exists, use CSV as seed
                if (!savedState && preloadRes && preloadRes.ok) {
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
                        const reconciledPlayers = parsedPlayers.map(p => {
                            const match = savedDrafted.find(dp => dp.name === p.name);
                            if (match) {
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
                        const enrichedDrafted = savedDrafted.map(sd => {
                            const updatedMetadata = parsedPlayers.find(p => p.name === sd.name);
                            const draftedByUs = sd.draftedByUs === true || sd.team === TEAM_CONFIG.abbreviation; // Trust persisted or evaluate from CSV team string
                            if (updatedMetadata) {
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

                        setRemotePicks(savedState && Array.isArray(parsedState.remotePicks) ? parsedState.remotePicks : []);
                        
                        // Seed current pick explicitly from highest historically recorded pick + 1 for Preloads
                        if (!savedState && enrichedDrafted.length > 0) {
                            const lastPick = enrichedDrafted.reduce((max, p) => Math.max(max, p.pickNumber), 0);
                            setCurrentPick(lastPick + 1);
                        }
                    } catch (e) {
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

        setPlayers(prev => prev.map(p =>
            p.name === player.name
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

        triggerChime();
        setCurrentPick(prev => prev + 1);
    }, [currentPick, ourPicksLeft, remotePicks, saveHistory, triggerChime]);

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

    const resetDraft = useCallback(() => {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
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
        const enrichedDrafted = importedDrafted.map(id => {
            const playerFromRankings = players.find(p => p.name === id.name);
            const draftedByUs = id.draftedByUs === true || id.team === TEAM_CONFIG.abbreviation;
            if (playerFromRankings) {
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
        setPlayers(prev => prev.map(p => {
            const match = enrichedDrafted.find(dp => dp.name === p.name);
            if (match) {
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
                        
                        const playerIndex = findMatchingPlayerIndex(rp.player.name, updatedPlayers);

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
    }, [isLiveSync, loading, draftedPlayers, yourPicks, ourPicksLeft, currentPick]);

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
        undoAction,
        updateOurPicks,
        resetDraft,
        importDraftState
    };
};

export default useDraftState;
