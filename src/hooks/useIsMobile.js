import { useSyncExternalStore } from 'react';

// Matches the 1024px breakpoint the stylesheet uses for its mobile layout
// rules, so JS-side layout decisions (panel vs modal presentation) can't
// drift out of sync with the CSS.
const QUERY = '(max-width: 1024px)';

const mql = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(QUERY)
    : null;

function subscribe(cb) {
    if (!mql) return () => {};
    mql.addEventListener('change', cb);
    return () => mql.removeEventListener('change', cb);
}

export default function useIsMobile() {
    return useSyncExternalStore(
        subscribe,
        () => (mql ? mql.matches : false),
        () => false, // server/no-matchMedia: assume desktop
    );
}
