import React from 'react';
import { draftLead, iAmLead, claimLead, releaseLead } from '../data/draftStore';
import { authorById } from '../utils/boardRegistry';
import { repository } from '../data/repository';

/**
 * Who is running the live draft, and whether you are watching him.
 *
 * A broadcast has one draft board. Two experts picking into the same document
 * would overwrite each other mid-round, so exactly one holds the LEAD and his
 * picks are the ones that reach the database. Everybody else follows him — which
 * is the default, because a draft in progress is what the show is about — or
 * works on a draft of his own that never leaves his machine.
 *
 * Only shown where there is a shared database to lead on. A local-only build has
 * one person and nothing to coordinate, and a control that says "claim the lead"
 * to somebody who is alone is noise.
 */
export default function LeadControl({ seasonId, onChange }) {
    if (!repository.isLive() || !seasonId) return null;

    const holder = draftLead(seasonId);
    const mine = iAmLead(seasonId);
    const me = repository.identity();
    const canLead = !!me && repository.isExpert?.();

    // A name where the holder has an author record, the raw id otherwise —
    // never nothing, because "somebody else is leading" with no idea who is
    // worse than a bare id.
    const holderName = holder ? (authorById(holder)?.name ?? holder) : null;

    const act = (fn) => () => { fn(seasonId); onChange?.(); };

    if (!canLead) {
        // A viewer. He follows by construction: he cannot write the shared draft
        // whatever this says, so the only useful thing is who he is watching.
        return (
            <span className="lead-control lead-following" title="The live draft you are following">
                {holder ? `Following ${holderName}` : 'No live draft yet'}
            </span>
        );
    }

    if (mine) {
        return (
            <span className="lead-control lead-mine">
                <strong>You are leading</strong>
                <button type="button" className="action-pill" onClick={act(releaseLead)}
                    title="Give up the lead. Your picks stay exactly where they are, and whoever claims it next continues from there.">
                    Release lead
                </button>
            </span>
        );
    }

    if (holder) {
        // Deliberately no "take the lead" here. It is his to release — a draft
        // changing hands under the man running it is precisely what should not
        // happen live on air.
        return (
            <span className="lead-control lead-following" title="His picks are the live draft. Yours stay on this machine.">
                Following <strong>{holderName}</strong>
            </span>
        );
    }

    return (
        <span className="lead-control">
            <button type="button" className="action-pill" onClick={act(claimLead)}
                title="Run the live draft. Your picks reach everybody; nobody else's do.">
                Claim the lead
            </button>
        </span>
    );
}
