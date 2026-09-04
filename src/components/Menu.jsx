import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

// Dropdown for secondary actions. Toolbars had grown to 4-6 pills each,
// which on a broadcast is visual noise competing with the board itself and
// on mobile pushed real controls off-screen. Frequent actions stay as
// buttons; everything occasional (imports, exports, resets) moves in here.
//
// The list renders in a portal on document.body with fixed positioning
// rather than absolutely inside the toolbar: the view shells (.roster-view,
// .scouting-layout) set `overflow: hidden`, which clips a normally-positioned
// dropdown no matter how high its z-index, so the menu was vanishing behind
// the panels below it.
//
// Items: { label, onClick, tone?: 'danger', title?, file?: { accept, onFile } }
// A `file` item renders a hidden file input so "Import…" works from the menu
// without the caller wiring up its own label/input pair.
export default function Menu({ items, label = 'More', align = 'right' }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const triggerRef = useRef(null);
    const listRef = useRef(null);

    const place = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setPos({
            top: r.bottom + 6,
            // Anchor the edge the caller asked for; the list is width-auto so
            // we pin one side and let it grow inward.
            ...(align === 'right'
                ? { right: Math.max(8, window.innerWidth - r.right) }
                : { left: Math.max(8, r.left) }),
        });
    }, [align]);

    useEffect(() => {
        if (!open) return;
        place();
        const onDocPointer = (e) => {
            if (triggerRef.current?.contains(e.target)) return;
            if (listRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        // Reposition rather than drift: the trigger lives in a toolbar that
        // can scroll horizontally on mobile.
        const onReflow = () => place();

        document.addEventListener('mousedown', onDocPointer);
        window.addEventListener('keydown', onKey);
        window.addEventListener('resize', onReflow);
        window.addEventListener('scroll', onReflow, true);
        return () => {
            document.removeEventListener('mousedown', onDocPointer);
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onReflow);
            window.removeEventListener('scroll', onReflow, true);
        };
    }, [open, place]);

    return (
        <div className="app-menu">
            <button
                ref={triggerRef}
                className="action-pill app-menu-trigger"
                onClick={() => setOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                {label} <span className="app-menu-caret">▾</span>
            </button>

            {open && pos && createPortal(
                <div ref={listRef} className="app-menu-list" style={{ position: 'fixed', ...pos }} role="menu">
                    {items.filter(Boolean).map((item, i) => (
                        item.file ? (
                            <label key={i} className="app-menu-item" role="menuitem" title={item.title}>
                                {item.label}
                                <input
                                    type="file"
                                    accept={item.file.accept}
                                    style={{ display: 'none' }}
                                    onChange={e => { item.file.onFile(e); setOpen(false); }}
                                />
                            </label>
                        ) : (
                            <button
                                key={i}
                                className={`app-menu-item${item.tone === 'danger' ? ' danger' : ''}`}
                                role="menuitem"
                                title={item.title}
                                onClick={() => { setOpen(false); item.onClick(); }}
                            >
                                {item.label}
                            </button>
                        )
                    ))}
                </div>,
                document.body,
            )}
        </div>
    );
}
