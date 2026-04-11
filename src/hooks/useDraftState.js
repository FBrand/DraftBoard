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

    // Check if live sync module is available
    useEffect(() => {
        const modules = import.meta.glob('../services/ESPNProvider.js');
        if (Object.keys(modules).length > 0) {
            setCanLiveSync(true);
        } else {
            setCanLiveSync(false);
            setIsLiveSync(false); // Disable if not available
        }
    }, []);

    const saveHistory = useCallback(() => {
        setHistory(prev => ({ players, ourPicksLeft, currentPick, draftedPlayers, yourPicks }));
    }, [players, ourPicksLeft, currentPick, draftedPlayers, yourPicks]);

    // Initial load
    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const base = import.meta.env.BASE_URL;
                const [rankingsRes, picksRes] = await Promise.all([
                    fetch(`${base}rankings.csv`),
                    fetch(`${base}picks.txt`)
                ]);

                const rankingsText = await rankingsRes.text();
                const picksText = await picksRes.text();

                const parsedPlayers = parseRankings(rankingsText) || [];
                const parsedOurPicks = parsePicks(picksText) || [];

                // Check localStorage
                const savedState = localStorage.getItem(DRAFT_STORAGE_KEY);
                if (savedState) {
                    try {
                        const s = JSON.parse(savedState);
                        setPlayers(Array.isArray(s.players) ? s.players : parsedPlayers);
                        setOurPicksLeft(Array.isArray(s.ourPicksLeft) ? s.ourPicksLeft : parsedOurPicks);
                        setCurrentPick(typeof s.currentPick === 'number' ? s.currentPick : 1);
                        setDraftedPlayers(Array.isArray(s.draftedPlayers) ? s.draftedPlayers : []);
                        setYourPicks(Array.isArray(s.yourPicks) ? s.yourPicks : []);
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
            const state = { players, ourPicksLeft, currentPick, draftedPlayers, yourPicks };
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(state));
        }
    }, [players, ourPicksLeft, currentPick, draftedPlayers, yourPicks, loading]);

    // Persist Live Sync setting
    useEffect(() => {
        localStorage.setItem(IS_LIVE_SYNC_KEY, isLiveSync);
    }, [isLiveSync]);

    const draftPlayer = useCallback((player) => {
        if (player.drafted) return;
        saveHistory();

        const pickNumber = currentPick;
        const isOurPick = ourPicksLeft.includes(pickNumber);

        setPlayers(prev => prev.map(p =>
            p.name === player.name
                ? { ...p, drafted: true, pickNumber, draftedByUs: isOurPick }
                : p
        ));

        const draftedPlayer = { ...player, drafted: true, pickNumber, draftedByUs: isOurPick };
        setDraftedPlayers(prev => [...prev, draftedPlayer]);

        if (isOurPick) {
            setYourPicks(prev => [...prev, draftedPlayer]);
            // Remove this pick from ourPicksLeft since it's been used
            setOurPicksLeft(prev => prev.filter(pk => pk !== pickNumber));
        }

        setCurrentPick(prev => prev + 1);
    }, [currentPick, ourPicksLeft, saveHistory]);

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
        toggleLiveSync: () => setIsLiveSync(prev => !prev),
        draftPlayer,
        undoAction,
        updateOurPicks,
        resetDraft
    };
};

export default useDraftState;
