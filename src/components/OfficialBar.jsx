import React, { useState } from 'react';
import { ConfirmDialog } from './Dialogs';

/**
 * Where a personal chart meets the official one.
 *
 * Every stage is per person — each analyst's own free agency and roster, because
 * they disagree about who to bring in and what to do with a pick. Alongside
 * those sits ONE official version: what the show says. Nothing moves between
 * them on its own, and this strip is the whole of how they meet.
 *
 * Three actions, deliberately not one:
 *
 *   Make official     publishes mine over whatever is there. Confirmed, and
 *                     recorded with who did it, because it overwrites another
 *                     expert's publication and "who changed the roster" has to
 *                     have an answer.
 *   Take official     replaces mine. Confirmed, and it says how many players it
 *                     will move to the cut panel — never how many it will
 *                     delete, because it deletes none.
 *   Fill gaps         additive, so it needs no confirmation at all: it cannot
 *                     take anybody away.
 *
 * The other half of its job is telling somebody he has fallen behind. Official
 * moving does not touch a personal chart, which is right, and silent — so the
 * strip says when official was last published and by whom, and a chart that is
 * not yet the person's own says THAT rather than pretending to be his.
 */
export default function OfficialBar({
    stageLabel,
    isOwn,
    official,
    stamp,
    stampName,
    canPublish,
    onPublish,
    onAdopt,
    onFill,
    displacedCount,
}) {
    const [asking, setAsking] = useState(null);   // 'publish' | 'adopt' | null

    const when = stamp?.at ? new Date(stamp.at).toLocaleString() : null;
    const who = stampName ?? stamp?.by ?? null;

    return (
        <div className="official-bar">
            <span className="official-bar-state">
                {!isOwn && official
                    // Looking at somebody else's work, and it is worth saying so
                    // plainly: the first edit forks a personal copy, and a
                    // screen that looked editable while showing official is how
                    // one analyst's change becomes everybody's.
                    ? <>Showing the <strong>official</strong> {stageLabel} — your first change makes it yours</>
                    : <>Your own {stageLabel}</>}
                {official && when
                    ? <span className="official-bar-stamp"> · official set {who ? `by ${who} ` : ''}{when}</span>
                    : null}
                {!official
                    ? <span className="official-bar-stamp"> · nothing published yet</span>
                    : null}
            </span>

            <span className="official-bar-actions">
                {official && isOwn ? (
                    <>
                        <button type="button" className="action-pill" onClick={() => setAsking('adopt')}
                            title="Replace yours with the official version. Anybody it does not carry moves to the cut panel.">
                            Take official
                        </button>
                        <button type="button" className="action-pill" onClick={onFill}
                            title="Fill your empty slots from official. Never overwrites and never removes.">
                            Fill gaps from official
                        </button>
                    </>
                ) : null}

                {canPublish ? (
                    <button type="button" className="action-pill" onClick={() => setAsking('publish')}
                        title="Publish yours as the official version everybody can adopt">
                        Make official
                    </button>
                ) : null}
            </span>

            {asking === 'publish' ? (
                <ConfirmDialog
                    title={`Make this the official ${stageLabel}?`}
                    message={
                        (when
                            ? `This replaces the official ${stageLabel}${who ? ` published by ${who}` : ''} on ${when}. `
                            : `Nothing has been published yet, so this becomes the first official ${stageLabel}. `)
                        + 'Everybody will be able to adopt it, and nobody else’s own version is touched.'
                    }
                    confirmLabel="Make official"
                    onConfirm={() => { setAsking(null); onPublish(); }}
                    onCancel={() => setAsking(null)}
                />
            ) : null}

            {asking === 'adopt' ? (
                <ConfirmDialog
                    title={`Take the official ${stageLabel}?`}
                    message={
                        `Your ${stageLabel} is replaced by the official one. `
                        + (displacedCount
                            ? `${displacedCount} player${displacedCount === 1 ? '' : 's'} you have who the official ${stageLabel} does not carry move to the cut panel — nobody is deleted.`
                            : 'Nobody you have is lost.')
                    }
                    confirmLabel="Take official"
                    onConfirm={() => { setAsking(null); onAdopt(); }}
                    onCancel={() => setAsking(null)}
                />
            ) : null}
        </div>
    );
}
