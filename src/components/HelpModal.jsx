import React, { useEffect, useState } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';

/**
 * The user guide, shown inside the app.
 *
 * The guide is `public/USER_GUIDE.md` — one file, read both here and on
 * GitHub, so there is no second copy to fall out of date with the first. It is
 * fetched rather than imported so that correcting a sentence does not mean
 * rebuilding the app.
 *
 * The renderer below is deliberately small. Pulling in a Markdown library to
 * display one document we write ourselves would cost more than it returns:
 * this handles the subset the guide actually uses, and the guide is reviewed
 * alongside it.
 */

// Inline: `code`, **bold**, *italic*. Split rather than replaced into HTML, so
// nothing here can inject markup — the guide is ours, but this is one less
// thing to be careful about.
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

function inline(text, keyBase) {
    return text.split(INLINE).filter(Boolean).map((part, i) => {
        const key = `${keyBase}-${i}`;
        if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>;
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('*') && part.endsWith('*')) return <em key={key}>{part.slice(1, -1)}</em>;
        return <React.Fragment key={key}>{part}</React.Fragment>;
    });
}

function render(markdown) {
    const lines = String(markdown ?? '').split('\n');
    const out = [];
    let list = null;
    let table = null;
    let fence = null;

    const flush = () => {
        if (list) { out.push(<ul key={`ul${out.length}`}>{list}</ul>); list = null; }
        if (table) {
            const [head, ...body] = table;
            out.push(
                <table key={`t${out.length}`} className="help-table">
                    <thead><tr>{head.map((c, i) => <th key={i}>{inline(c, `th${i}`)}</th>)}</tr></thead>
                    <tbody>{body.map((row, r) => (
                        <tr key={r}>{row.map((c, i) => <td key={i}>{inline(c, `td${r}-${i}`)}</td>)}</tr>
                    ))}</tbody>
                </table>,
            );
            table = null;
        }
    };

    lines.forEach((raw, n) => {
        const line = raw.trimEnd();

        if (line.trim().startsWith('```')) {
            if (fence === null) { flush(); fence = []; }
            else { out.push(<pre key={`p${n}`}><code>{fence.join('\n')}</code></pre>); fence = null; }
            return;
        }
        if (fence !== null) { fence.push(raw); return; }

        // A table row, but not the `|---|---|` separator under the header.
        if (line.startsWith('|') && line.endsWith('|')) {
            const cells = line.slice(1, -1).split('|').map(c => c.trim());
            if (cells.every(c => /^:?-{2,}:?$/.test(c))) return;
            if (list) flush();
            (table ??= []).push(cells);
            return;
        }
        if (table) flush();

        if (!line.trim()) { flush(); return; }
        if (/^---+$/.test(line.trim())) { flush(); out.push(<hr key={`h${n}`} />); return; }

        const heading = line.match(/^(#{1,4})\s+(.*)$/);
        if (heading) {
            flush();
            const Tag = `h${heading[1].length}`;
            out.push(<Tag key={`hd${n}`}>{inline(heading[2], `hd${n}`)}</Tag>);
            return;
        }

        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        if (bullet) {
            (list ??= []).push(<li key={`li${n}`}>{inline(bullet[1], `li${n}`)}</li>);
            return;
        }

        flush();
        out.push(<p key={`pg${n}`}>{inline(line, `pg${n}`)}</p>);
    });

    flush();
    if (fence !== null) out.push(<pre key="pend"><code>{fence.join('\n')}</code></pre>);
    return out;
}

// The guide is a static file, so it is fetched once per page load and shared
// by every open of the modal — same reason the rankings files are cached in
// useBoardRankings.
let guidePromise = null;

function loadGuide() {
    if (guidePromise) return guidePromise;
    guidePromise = fetch(`${import.meta.env.BASE_URL}USER_GUIDE.md`)
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
        })
        .then(text => ({ status: 'ready', text }))
        .catch(() => ({ status: 'error', text: '' }));
    return guidePromise;
}

export default function HelpModal({ isOpen, onClose }) {
    const [state, setState] = useState({ status: 'loading', text: '' });

    useEscapeKey(onClose, isOpen);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        loadGuide().then(next => { if (!cancelled) setState(next); });
        return () => { cancelled = true; };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content help-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>User Guide</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>

                <div className="help-body">
                    {state.status === 'loading' && <p>Loading…</p>}
                    {state.status === 'error' && (
                        <p>
                            The guide could not be loaded. It lives in <code>USER_GUIDE.md</code>
                            {' '}alongside the app, and is readable there as plain text.
                        </p>
                    )}
                    {state.status === 'ready' && render(state.text)}
                </div>

                <div className="modal-actions">
                    <div style={{ flex: 1 }} />
                    <button type="button" className="action-button primary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
