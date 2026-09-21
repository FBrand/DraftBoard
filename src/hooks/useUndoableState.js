import { useState, useRef, useCallback } from 'react';

// Snapshots are whole state objects. A roster is ~25 rows and a scouting board
// tops out around 313 entries, so a bounded stack costs little memory and
// avoids the complexity of diffing or command objects — which would need every
// mutation rewritten to describe its own inverse.
const DEFAULT_LIMIT = 25;

/**
 * Wraps a store's single write path so every change is undoable.
 *
 * Each stage funnels all its writes through one function already
 * (RosterView/FreeAgencyView's `setState`, ScoutingView's `commitBoard`),
 * which is what makes this cheap: history is captured in one place per stage
 * rather than at every call site.
 *
 * `persist` is called with the committed value — stores own their own
 * serialisation, so this hook never touches storage itself.
 *
 * `initial` may be a value or a lazy initialiser, like useState — the stores
 * read localStorage to build theirs, which must not run on every render.
 *
 * Returns `[state, setState, { undo, canUndo, reset, adoptRemote }]`.
 * `reset` replaces the state *and* clears history, for loads and imports where
 * undoing back into the previous session's data would be nonsense.
 * `adoptRemote` replaces the state and touches neither history nor storage —
 * see the comment on it below for why `setState`/`reset` are both wrong for
 * a value that arrived from a live remote snapshot.
 */
export default function useUndoableState(initial, persist, limit = DEFAULT_LIMIT) {
    const [state, setStateRaw] = useState(initial);
    const past = useRef([]);
    const [canUndo, setCanUndo] = useState(false);

    const setState = useCallback((next) => {
        setStateRaw(prev => {
            const value = typeof next === 'function' ? next(prev) : next;
            if (value === prev) return prev;

            past.current.push(prev);
            if (past.current.length > limit) past.current.shift();
            setCanUndo(true);

            persist?.(value);
            return value;
        });
    }, [persist, limit]);

    const undo = useCallback(() => {
        setStateRaw(current => {
            const previous = past.current.pop();
            if (previous === undefined) return current;
            setCanUndo(past.current.length > 0);
            persist?.(previous);
            return previous;
        });
    }, [persist]);

    const reset = useCallback((value) => {
        past.current = [];
        setCanUndo(false);
        setStateRaw(value);
        persist?.(value);
    }, [persist]);

    // For a value that arrived FROM storage rather than from this browser's
    // own edits — a live snapshot from another expert's device. `setState`
    // and `reset` are both wrong for this: `setState` would push it onto the
    // undo stack, so pressing Undo afterward reverts someone ELSE's change
    // instead of the user's own; either one calling `persist` would write
    // the same value straight back out, echoing it to every other open
    // client. This sets what's on screen and nothing else — history and
    // storage are both left alone, since the data is already there.
    const adoptRemote = useCallback((value) => {
        setStateRaw(value);
    }, []);

    return [state, setState, { undo, canUndo, reset, adoptRemote }];
}
