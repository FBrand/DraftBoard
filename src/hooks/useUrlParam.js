import { useState, useEffect, useCallback } from 'react';

/**
 * Keeps a piece of view state in the query string, so what you're looking at
 * can be sent to someone else.
 *
 * The app had no router and kept the active tab in localStorage, which meant
 * no URL ever identified anything: you couldn't link to the roster, to one
 * analyst's board, or to a player. Everything downstream of sharing a board
 * depends on fixing that, so it's a plain History API hook rather than a
 * routing dependency — the app has exactly one page and a handful of
 * parameters.
 *
 * `allowed` (optional) whitelists values, so a hand-edited or stale URL falls
 * back to the default instead of putting the app in a state it can't render.
 */
export default function useUrlParam(key, defaultValue, allowed = null) {
    const read = useCallback(() => {
        try {
            const raw = new URLSearchParams(window.location.search).get(key);
            if (raw == null) return defaultValue;
            if (allowed && !allowed.includes(raw)) return defaultValue;
            return raw;
        } catch {
            return defaultValue;
        }
    }, [key, defaultValue, allowed]);

    const [value, setValue] = useState(read);

    // Back/forward should move through the app, not out of it.
    useEffect(() => {
        const onPop = () => setValue(read());
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, [read]);

    const set = useCallback((next, { replace = false } = {}) => {
        const params = new URLSearchParams(window.location.search);
        if (next == null || next === '') params.delete(key);
        else params.set(key, next);

        const qs = params.toString();
        const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
        // replace for incidental changes (which player is selected), push for
        // deliberate navigation (which stage you're on) — so Back does what
        // people expect rather than unwinding every click.
        if (replace) window.history.replaceState(null, '', url);
        else window.history.pushState(null, '', url);

        setValue(next ?? defaultValue);
    }, [key, defaultValue]);

    return [value, set];
}
