import { useState, useEffect, useCallback } from 'react';
import { parseRankings, parsePicks } from '../utils/dataParser';
import { TEAM_CONFIG } from '../constants';

const DRAFT_STORAGE_KEY = 'nfl_draft_board_state';
const IS_LIVE_SYNC_KEY = 'nfl_draft_live_sync';

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

    // Check if live sync module is available AND enabled via query param
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const syncEnabled = params.get('sync') === 'true';

        const checkAvailability = async () => {
            const modules = import.meta.glob('../services/ESPNProvider.js');
            const hasModule = Object.keys(modules).length > 0;

            if (hasModule && syncEnabled) {
                setCanLiveSync(true);
            } else {
                setCanLiveSync(false);
                setIsLiveSync(false); // Force off if not enabled/available
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
                const rankingsUrl = params.get('rankings') || `${base}rankings.csv`;

                const [rankingsRes, picksRes, columnsRes] = await Promise.all([
                    fetch(rankingsUrl),
                    fetch(`${base}picks.txt`),
                    fetch(`${base}columns.txt`)
                ]);

                const rankingsText = await rankingsRes.text();
                const picksText = await picksRes.text();
                const columnsText = await columnsRes.text().catch(() => "");
                const parsedPositions = columnsText.split(',').map(p => p.trim()).filter(p => p);
                setColumnOrder(parsedPositions);

                const parsedPlayers = parseRankings(rankingsText) || [];
                const parsedOurPicks = parsePicks(picksText) || [];

                // Check localStorage and reconcile instead of blind overwrite
                const savedState = localStorage.getItem(DRAFT_STORAGE_KEY);
                if (savedState) {
                    try {
                        const s = JSON.parse(savedState);
                        const savedDrafted = Array.isArray(s.draftedPlayers) ? s.draftedPlayers : [];
                        const savedKCLeft = Array.isArray(s.ourPicksLeft) ? s.ourPicksLeft : parsedOurPicks;

                        // Reconcile fresh parsedPlayers with saved history
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

                        setPlayers(reconciledPlayers);
                        setOurPicksLeft(savedKCLeft);
                        setCurrentPick(typeof s.currentPick === 'number' ? s.currentPick : 1);
                        setDraftedPlayers(savedDrafted);
                        setYourPicks(Array.isArray(s.yourPicks) ? s.yourPicks : []);
                        setRemotePicks(Array.isArray(s.remotePicks) ? s.remotePicks : []);
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

        setCurrentPick(prev => prev + 1);
    }, [currentPick, ourPicksLeft, remotePicks, saveHistory]);

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

        // Enrich imported player objects with ranking metadata if available
        const enrichedDrafted = importedDrafted.map(id => {
            const playerFromRankings = players.find(p => p.name === id.name);
            if (playerFromRankings) {
                return {
                    ...playerFromRankings,
                    pickNumber: id.pickNumber,
                    team: id.team,
                    drafted: true,
                    draftedByUs: importedKCLeft.includes(id.pickNumber)
                };
            }
            return id; // Keep as is if unranked
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
                    draftedByUs: importedKCLeft.includes(match.pickNumber)
                };
            }
            return { ...p, drafted: false, pickNumber: null, team: null, draftedByUs: false };
        }));

        // Reconcile 'yourPicks' (KC history)
        const newYourPicks = enrichedDrafted.filter(dp => importedKCLeft.includes(dp.pickNumber));
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

                if (JSON.stringify(chiefsPicks.sort()) !== JSON.stringify(updatedKCLeft.sort())) {
                    setOurPicksLeft(chiefsPicks);
                    changed = true;
                }

                // 2. Process picks with players
                picks.forEach(rp => {
                    if (rp.player) {
                        const playerIndex = updatedPlayers.findIndex(p =>
                            p.name.toLowerCase() === rp.player.name.toLowerCase() ||
                            p.name.toLowerCase().includes(rp.player.name.toLowerCase())
                        );

                        if (playerIndex !== -1 && !updatedPlayers[playerIndex].drafted) {
                            const player = { ...updatedPlayers[playerIndex] };
                            player.drafted = true;
                            player.pickNumber = rp.overall;
                            player.draftedByUs = (rp.team === TEAM_CONFIG.abbreviation);

                            updatedPlayers[playerIndex] = player;
                            updatedDrafted.push(player);
                            if (player.draftedByUs) {
                                updatedYourPicks.push(player);
                            }
                            changed = true;
                        }
                        if (rp.overall >= maxOverall) {
                            maxOverall = rp.overall + 1;
                        }
                    }
                });

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
