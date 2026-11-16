import { useEffect, useState } from 'react';
import { api, setToken, type Session } from './api';

export function Login({ notice, onLogin }: { notice: string; onLogin: (session: Session) => void }) {
  const [names, setNames] = useState<{ id: number; name: string }[] | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .loginNames()
      .then((r) => setNames(r.customers))
      .catch((e) => setError(e.message));
  }, []);

  async function login(body: Parameters<typeof api.login>[0]) {
    setBusy(true);
    setError('');
    try {
      const { token, ...session } = await api.login(body);
      setToken(token);
      onLogin(session as Session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-grid">
      {notice && <p className="alert info wide">{notice}</p>}
      {error && (
        <p className="alert error wide" role="alert">
          {error}
        </p>
      )}

      <section className="card">
        <h2>Customer Login</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (customerId) login({ role: 'customer', customerId: Number(customerId) });
          }}
        >
          <label htmlFor="customer">Your Name</label>
          <select id="customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">{names ? '— Select your name —' : 'Loading…'}</option>
            {names?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!customerId || busy}>
            Login
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Bank Manager Login</h2>
        <p className="muted">Add customers, open accounts and manage the customer list.</p>
        <button disabled={busy} onClick={() => login({ role: 'manager' })}>
          Login as Bank Manager
        </button>
      </section>
    </div>
  );
}
