import React from 'react';
import { onAuthChange, signInExpert, signOutExpert } from '../utils/auth';
import { backendName } from '../data/backend';

/**
 * Who you are signed in as, and the way to change it.
 *
 * Silent on a local build, like SyncStatus: with no shared database there is
 * nobody to be, and a "Sign in" button that cannot lead anywhere is worse than
 * no button. So this renders nothing unless the app was built to talk to
 * Firebase.
 *
 * It is also silent for a viewer who has never signed in — which is almost
 * everybody, and the case the app is FOR. A viewer is signed in anonymously so
 * his play-along has an identity of its own; telling him so would be answering
 * a question he did not ask. He gets one small, unobtrusive way in, because the
 * ten people who need it have to find it somewhere.
 *
 * The popup is deliberate and lives in auth.js: no password is ever typed into
 * this app.
 */
export default function SessionUser() {
    const [user, setUser] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [problem, setProblem] = React.useState(null);

    // Subscribed even on a local build — the hook is free and calling hooks
    // conditionally is not allowed. The render below is what goes quiet.
    React.useEffect(() => onAuthChange(setUser), []);

    if (backendName() !== 'firebase') return null;

    const expert = !!user && !user.isAnonymous;

    const attempt = async (fn) => {
        setBusy(true);
        setProblem(null);
        try {
            await fn();
        } catch (err) {
            // A closed popup is not an error worth shouting about; anything
            // else is worth saying out loud rather than failing silently.
            const code = err?.code ?? '';
            if (!/popup-closed-by-user|cancelled-popup-request/.test(code)) {
                setProblem(code || 'Sign-in failed');
            }
        } finally {
            setBusy(false);
        }
    };

    if (expert) {
        return (
            <span className="session-user">
                <span className="session-user-name" title={user.email ?? user.name}>{user.name}</span>
                <button
                    type="button"
                    className="view-tab"
                    disabled={busy}
                    onClick={() => attempt(signOutExpert)}
                    title="Stop writing to the shared boards and go back to watching"
                >Sign out</button>
            </span>
        );
    }

    return (
        <span className="session-user">
            {problem && <span className="session-user-problem" role="status">{problem}</span>}
            <button
                type="button"
                className="view-tab"
                disabled={busy}
                onClick={() => attempt(signInExpert)}
                title="For analysts who publish boards. Everyone else can use the app without signing in."
            >{busy ? 'Signing in…' : 'Sign in'}</button>
        </span>
    );
}
