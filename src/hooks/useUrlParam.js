import { useState, useEffect, useCallback, useRef } from 'react';

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

    // The latest value, readable without putting `value` in `set`'s deps —
    // which would hand every caller a new `set` on each change. Written in an
    // effect rather than during render, which is the only place a ref may be
    // touched.
    const valueRef = useRef(value);
    useEffect(() => { valueRef.current = value; }, [value]);

    // Back/forward should move through the app, not out of it.
    useEffect(() => {
        const onPop = () => setValue(read());
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, [read]);

    const set = useCallback((next, { replace = false } = {}) => {
        // A functional update, like setState takes. Without this the callback
        // itself went into the query string — a scouting link came out reading
        // `player=t%3D%3Et%3D%3D%3De.name%3Fnull%3Ae.name`, the minified
        // toggle stringified. In-session nothing looked wrong, because React's
        // own setState resolved the same function correctly; only the URL was
        // wrong, so only a SHARED link was broken, which is the one thing this
        // hook exists for.
        const current = read() ?? valueRef.current;
        const resolved = typeof next === 'function' ? next(current) : next;

        const params = new URLSearchParams(window.location.search);
        if (resolved == null || resolved === '') params.delete(key);
        else params.set(key, resolved);

        const qs = params.toString();
        const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
        // replace for incidental changes (which player is selected), push for
        // deliberate navigation (which stage you're on) — so Back does what
        // people expect rather than unwinding every click.
        if (replace) window.history.replaceState(null, '', url);
        else window.history.pushState(null, '', url);

        setValue(resolved ?? defaultValue);
    }, [key, defaultValue, read]);

    return [value, set];
}
