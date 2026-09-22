import React, { useState, useEffect, useCallback } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';
import { listExperts, inviteExpert, revokeExpert, reinstateExpert, currentUser } from '../utils/auth';

/**
 * Who may act as an expert, and the two buttons that change it.
 *
 * Only reachable from the Manage menu when the current user is already an
 * expert, so there is no permission check here — firestore.rules is the real
 * gate and this would be a courtesy at best.
 *
 * **Access is the INVITE, and the invite is a document that exists or does
 * not.** There is no active flag anywhere: revoking deletes the
 * `email2author` entry, which refuses his next write immediately and
 * everywhere, and reinstating writes it back. The list below therefore shows
 * three states rather than two, because the middle one is real and worth
 * seeing:
 *
 *   Active    invited, and has signed in — he has an author record
 *   Invited   invited, never turned up — no author yet, nothing to revoke
 *             from except the invite itself
 *   Revoked   his invite is gone, but his author record remains, because an
 *             author is permanent: his boards still name him and his
 *             evaluations are still in his voice
 *
 * Revoking also releases the boards he was holding, back to unclaimed — see
 * auth.revokeExpert. Reinstating hands back only the ones nobody else picked
 * up meanwhile.
 */
export default function ManageExpertsModal({ isOpen, onClose }) {
    const [experts, setExperts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [inviting, setInviting] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [busyEmail, setBusyEmail] = useState(null);
    const myEmail = (currentUser()?.email ?? '').toLowerCase();

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setExperts(await listExperts());
        } catch (err) {
            setError(err.message ?? 'Could not load the expert list.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            setEmail('');
            setError(null);
            setNotice(null);
            load();
        }
    }, [isOpen, load]);

    useEscapeKey(onClose, isOpen);

    if (!isOpen) return null;

    const handleInvite = async (e) => {
        e.preventDefault();
        setError(null);
        setNotice(null);
        setInviting(true);
        try {
            const { email: added } = await inviteExpert(email);
            setNotice(`${added} invited. They become an expert the first time they sign in.`);
            setEmail('');
            await load();
        } catch (err) {
            setError(err.message ?? 'Could not invite that address.');
        } finally {
            setInviting(false);
        }
    };

    const handleRevoke = async (target) => {
        setError(null);
        setNotice(null);
        setBusyEmail(target.email);
        try {
            await revokeExpert(target.email);
            // No count to report: his boards are not rewritten, they simply
            // answer "claimable" from now on because he is no longer invited.
            setNotice(`${target.email} revoked. Any board of theirs can now be claimed by another expert.`);
            await load();
        } catch (err) {
            setError(err.message ?? 'Could not revoke that expert.');
        } finally {
            setBusyEmail(null);
        }
    };

    const handleReinstate = async (target) => {
        setError(null);
        setNotice(null);
        setBusyEmail(target.email);
        try {
            await reinstateExpert(target.email, target.authorId);
            setNotice(`${target.email} reinstated. Anything still theirs is theirs again; anything claimed while they were gone stays with whoever took it.`);
            await load();
        } catch (err) {
            setError(err.message ?? 'Could not reinstate that expert.');
        } finally {
            setBusyEmail(null);
        }
    };

    const statusOf = (x) => {
        if (!x.active) return { label: 'Revoked', tone: 'revoked' };
        if (!x.signedIn) return { label: 'Invited', tone: 'invited' };
        return { label: 'Active', tone: 'active' };
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content app-settings" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Manage Experts</h2>
                    <button className="close-button" onClick={onClose} aria-label="Close">&times;</button>
                </div>

                {error && <div className="ap-error">{error}</div>}

                <div className="settings-body">
                    <div className="settings-field">
                        <span className="settings-label">Who may publish</span>
                        <span className="settings-hint">
                            An expert writes the shared boards; everybody else reads them and
                            keeps their own work in their own browser. Revoking takes effect
                            on their next action and releases the boards they were holding —
                            their own work stays theirs, and their name stays on it.
                        </span>

                        {loading ? (
                            <p className="expert-empty">Loading…</p>
                        ) : experts.length === 0 ? (
                            <p className="expert-empty">Nobody has been invited yet.</p>
                        ) : (
                            <ul className="season-list expert-list">
                                {experts.map((x) => {
                                    const status = statusOf(x);
                                    const isSelf = x.email === myEmail;
                                    const busy = busyEmail === x.email;
                                    return (
                                        <li key={x.email} className="expert-row">
                                            <span className="expert-who">
                                                <span className="expert-name">{x.name ?? x.email}</span>
                                                {x.name && <span className="expert-email">{x.email}</span>}
                                            </span>
                                            <span className={`expert-status ${status.tone}`}>{status.label}</span>
                                            {isSelf ? (
                                                <span className="expert-self">you</span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="action-pill"
                                                    disabled={busy}
                                                    onClick={() => (x.active ? handleRevoke(x) : handleReinstate(x))}
                                                    title={x.active
                                                        ? 'Delete their invite — refuses every write from their next action on'
                                                        : 'Write their invite back, and return any board of theirs nobody else claimed'}
                                                >
                                                    {busy ? '…' : (x.active ? 'Revoke' : 'Reinstate')}
                                                </button>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    <form className="settings-field" onSubmit={handleInvite}>
                        <span className="settings-label">Invite an expert</span>
                        <span className="settings-hint">
                            The address they sign in to Google with. Nothing is created for
                            them until they actually sign in — the invite is only permission
                            to.
                        </span>
                        <div className="expert-invite">
                            <input
                                type="email"
                                className="text-input"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="expert@example.com"
                                required
                                disabled={inviting}
                            />
                            <button
                                type="submit"
                                className="action-button primary"
                                disabled={inviting || !email.trim()}
                            >{inviting ? 'Inviting…' : 'Invite'}</button>
                        </div>
                        {notice && <span className="expert-notice">{notice}</span>}
                    </form>
                </div>

                <div className="modal-actions ap-actions">
                    <div style={{ flex: 1 }} />
                    <button type="button" className="action-button secondary" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
}
