import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getToken, setToken, type Session } from './api';
import { CustomerView } from './CustomerView';
import { Login } from './Login';
import { ManagerView } from './ManagerView';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [notice, setNotice] = useState('');

  const logout = useCallback((message = '') => {
    setToken(null);
    setSession(null);
    setNotice(message);
  }, []);

  // Restore the session after a page refresh by asking the server who we are.
  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then(setSession)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  /** Shared handler: an expired / revoked session sends the user back to login. */
  const onAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        logout('Your session has ended. Please log in again.');
        return true;
      }
      return false;
    },
    [logout],
  );

  return (
    <div className="page">
      <header className="topbar">
        <h1>XYZ Bank</h1>
        {session && (
          <div className="topbar-right">
            <span className="muted">
              {session.role === 'manager'
                ? 'Bank Manager'
                : `${session.customer.firstName} ${session.customer.lastName}`}
            </span>
            <button className="secondary" onClick={() => logout()}>
              Logout
            </button>
          </div>
        )}
      </header>
      <main>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !session ? (
          <Login
            notice={notice}
            onLogin={(s) => {
              setNotice('');
              setSession(s);
            }}
          />
        ) : session.role === 'manager' ? (
          <ManagerView onAuthError={onAuthError} />
        ) : (
          <CustomerView customer={session.customer} onAuthError={onAuthError} />
        )}
      </main>
    </div>
  );
}
