import { useEffect } from 'react';

// Close-on-Escape for modals/dialogs. This app is a live broadcast companion
// (see CLAUDE.md), so a modal left open on screen with no keyboard way out is
// a real on-air problem — every overlay should be dismissable without hunting
// for the ✕ with a mouse.
//
// Pass `active` false when the modal isn't shown, so background instances
// don't swallow Escape from whatever is actually open.
export default function useEscapeKey(onEscape, active = true) {
    useEffect(() => {
        if (!active || !onEscape) return;
        const handler = (e) => { if (e.key === 'Escape') onEscape(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onEscape, active]);
}
