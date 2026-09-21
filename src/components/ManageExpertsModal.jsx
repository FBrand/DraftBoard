import React, { useState, useEffect, useCallback } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';
import { listAllowedExperts, addAllowedExpert, setExpertActive, currentUser } from '../utils/auth';

/**
 * Modal for viewing and adding authorized experts (allowed_users).
 *
 * Only reachable from the Manage menu when the current user is already an
 * expert, so no permission check is needed here — the Firestore rules are
 * the real gate.
 *
 * Delete is intentionally omitted — removal is a console operation on
 * purpose, so the audit trail (who added whom, when) can never be erased.
 * Deactivating (below) is the in-app way to revoke write access; a
 * deactivated expert stays listed, with a status pill, rather than
 * disappearing.
 */
export default function ManageExpertsModal({ isOpen, onClose }) {
    const [experts, setExperts]     = useState([]);
    const [loading, setLoading]     = useState(false);
    const [email, setEmail]         = useState('');
    const [adding, setAdding]       = useState(false);
    const [error, setError]         = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);
    const [togglingEmail, setTogglingEmail] = useState(null);
    const myEmail = (currentUser()?.email ?? '').toLowerCase();

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setExperts(await listAllowedExperts());
        } catch (err) {
            setError(err.message ?? 'Could not load expert list.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            setEmail('');
            setError(null);
            setSuccessMsg(null);
            load();
        }
    }, [isOpen, load]);

    useEscapeKey(onClose, isOpen);

    if (!isOpen) return null;

    const handleAdd = async (e) => {
        e.preventDefault();
        setError(null);
        setSuccessMsg(null);
        setAdding(true);
        try {
            await addAllowedExpert(email.trim());
            setSuccessMsg(`${email.trim().toLowerCase()} added.`);
            setEmail('');
            await load();
        } catch (err) {
            setError(err.message ?? 'Could not add expert.');
        } finally {
            setAdding(false);
        }
    };

    const handleToggle = async (targetEmail, nextActive) => {
        setError(null);
        setSuccessMsg(null);
        setTogglingEmail(targetEmail);
        try {
            await setExpertActive(targetEmail, nextActive);
            await load();
        } catch (err) {
            setError(err.message ?? 'Could not update that expert.');
        } finally {
            setTogglingEmail(null);
        }
    };

    const fmtDate = (iso) => {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
        } catch {
            return iso;
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content"
                style={{ maxWidth: 480 }}
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h2>Manage Experts</h2>
                    <button
                        type="button"
                        className="close-button"
                        onClick={onClose}
                        aria-label="Close"
                    >×</button>
                </div>

                {/* Expert list */}
                {loading ? (
                    <p style={{ padding: '0.5rem 0', color: 'var(--c-muted, #888)' }}>Loading…</p>
                ) : experts.length === 0 ? (
                    <p style={{ padding: '0.5rem 0', color: 'var(--c-muted, #888)' }}>No experts registered yet.</p>
                ) : (
                    <ul className="season-list" style={{ marginBottom: '1rem' }}>
                        {experts.map(({ email: e, addedBy, addedAt, active }) => {
                            const isSelf = e === myEmail;
                            return (
                                <li key={e} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', minWidth: 0 }}>
                                        <span style={{ fontWeight: 500 }}>{e}</span>
                                        <span
                                            className={`action-pill${active ? ' active' : ''}`}
                                            style={{ fontSize: '0.75em', padding: '0.1em 0.5em', pointerEvents: 'none' }}
                                        >{active ? 'Active' : 'Inactive'}</span>
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                                        <span style={{ fontSize: '0.8em', color: 'var(--c-muted, #888)', whiteSpace: 'nowrap' }}>
                                            {addedBy ? `added by ${addedBy}` : ''}{addedBy && addedAt ? ', ' : ''}{fmtDate(addedAt)}
                                        </span>
                                        {!isSelf && (
                                            <button
                                                type="button"
                                                className="action-pill"
                                                disabled={togglingEmail === e}
                                                onClick={() => handleToggle(e, !active)}
                                                title={active ? 'Revoke this expert\'s write access' : 'Restore this expert\'s write access'}
                                            >
                                                {togglingEmail === e ? '…' : (active ? 'Deactivate' : 'Reactivate')}
                                            </button>
                                        )}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {/* Add form */}
                <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="expert@example.com"
                        required
                        disabled={adding}
                        style={{ flex: 1, minWidth: 0 }}
                    />
                    <button
                        type="submit"
                        className="action-pill"
                        disabled={adding || !email.trim()}
                    >
                        {adding ? 'Adding…' : 'Add Expert'}
                    </button>
                </form>

                {error    && <p className="ap-error" style={{ marginTop: '0.5rem' }}>{error}</p>}
                {successMsg && <p style={{ marginTop: '0.5rem', color: 'var(--c-success, green)', fontSize: '0.9em' }}>{successMsg}</p>}
            </div>
        </div>
    );
}
