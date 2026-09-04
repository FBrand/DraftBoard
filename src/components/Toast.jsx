import React, { useEffect } from 'react';

// Transient status message. Replaces window.alert for error reporting (native
// alert chrome looks wrong on stream and blocks the whole page), and gives
// otherwise-silent bulk actions something to report — "Sync from FA/Draft/UDFA"
// in particular could place nothing at all and look broken with no feedback.
export default function Toast({ message, tone = 'info', onDismiss, duration = 6000 }) {
    useEffect(() => {
        if (!message) return;
        const t = setTimeout(onDismiss, duration);
        return () => clearTimeout(t);
    }, [message, onDismiss, duration]);

    if (!message) return null;
    return (
        <div className={`app-toast app-toast--${tone}`} role="status">
            <span>{message}</span>
            <button onClick={onDismiss} aria-label="Dismiss">&times;</button>
        </div>
    );
}
