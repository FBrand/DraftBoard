import { useState, useEffect, useCallback } from 'react';
import { parseRankings, parsePicks } from '../utils/dataParser';

const DRAFT_STORAGE_KEY = 'nfl_draft_board_state';

const useDraftState = () => {
    const [players, setPlayers] = useState([]);
    const [ourPicksLeft, setOurPicksLeft] = useState([]);
    const [draftedPlayers, setDraftedPlayers] = useState([]);
    const [yourPicks, setYourPicks] = useState([]);
    const [currentPick, setCurrentPick] = useState(1);
    const [history, setHistory] = useState(null);
    const [loading, setLoading] = useState(true);

    // Initial load
    useEffect(() => {
        const loadDraftData = async () => {
            try {
                // 1. Fetch static data
                const base = import.meta.env.BASE_URL;
                const [rankingsRes, picksRes] = await Promise.all([
                    fetch(`${base}rankings.csv`),
                    fetch(`${base}picks.txt`)
                ]);
                const rankingsText = await rankingsRes.text();
                const picksText = await picksRes.text();

                const initialPlayers = parseRankings(rankingsText);
                const initialPicks = parsePicks(picksText);

                // 2. Check LocalStorage for saved state
                const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
                if (saved) {
                    const parsed = JSON.parse(saved);

                    // Re-sync player drafted status
                    const syncedPlayers = initialPlayers.map(p => {
                        const drafted = parsed.draftedPlayers.find(dp => dp.name === p.name && dp.position === p.position);
                        return drafted ? { ...p, ...drafted } : p;
                    });

                    setPlayers(syncedPlayers);
                    setOurPicksLeft(parsed.ourPicksLeft);
                    setDraftedPlayers(parsed.draftedPlayers);
                    setYourPicks(parsed.yourPicks);
                    setCurrentPick(parsed.currentPick);
                } else {
                    setPlayers(initialPlayers);
                    setOurPicksLeft(initialPicks);
                }

                setLoading(false);
            } catch (error) {
                console.error('Error loading draft data:', error);
                setLoading(false);
            }
        };
        loadDraftData();
    }, []);

    // Save to LocalStorage whenever state changes
    useEffect(() => {
        if (!loading) {
            const stateToSave = {
                ourPicksLeft,
                draftedPlayers,
                yourPicks,
                currentPick
            };
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(stateToSave));
        }
    }, [ourPicksLeft, draftedPlayers, yourPicks, currentPick, loading]);

    const draftPlayer = useCallback((player) => {
        if (player.drafted) return;

        setHistory({
            type: 'DRAFT',
            state: { players, ourPicksLeft, draftedPlayers, yourPicks, currentPick }
        });

        const isOurPick = ourPicksLeft.includes(currentPick);
        const draftedPlayer = {
            ...player,
            drafted: true,
            draftedByUs: isOurPick,
            pickNumber: currentPick
        };

        setPlayers(prev => prev.map(p => (p.name === player.name && p.position === player.position) ? draftedPlayer : p));
        setDraftedPlayers(prev => [...prev, draftedPlayer]);

        if (isOurPick) {
            setYourPicks(prev => [...prev, draftedPlayer]);
            setOurPicksLeft(prev => prev.filter(p => p !== currentPick));
        }

        setCurrentPick(prev => prev + 1);
    }, [players, ourPicksLeft, draftedPlayers, yourPicks, currentPick]);

    const updateOurPicks = useCallback((newList) => {
        setHistory({
            type: 'TRADE',
            state: { ourPicksLeft }
        });
        setOurPicksLeft([...newList].sort((a, b) => a - b));
    }, [ourPicksLeft]);

    const resetDraft = useCallback(() => {
        if (!window.confirm("Are you sure you want to reset the entire draft? This cannot be undone.")) return;

        localStorage.removeItem(DRAFT_STORAGE_KEY);
        // Force reload to ensure fresh state from files
        window.location.reload();
    }, []);

    const undoAction = useCallback(() => {
        if (!history) return;

        if (history.type === 'DRAFT') {
            const { players, ourPicksLeft, draftedPlayers, yourPicks, currentPick } = history.state;
            setPlayers(players);
            setOurPicksLeft(ourPicksLeft);
            setDraftedPlayers(draftedPlayers);
            setYourPicks(yourPicks);
            setCurrentPick(currentPick);
        } else if (history.type === 'TRADE') {
            setOurPicksLeft(history.state.ourPicksLeft);
        }

        setHistory(null);
    }, [history]);

    return {
        players,
        ourPicksLeft,
        draftedPlayers,
        yourPicks,
        currentPick,
        history,
        loading,
        draftPlayer,
        updateOurPicks,
        resetDraft,
        undoAction
    };
};

export default useDraftState;
