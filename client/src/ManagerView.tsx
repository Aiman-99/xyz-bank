import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, CURRENCIES, SYMBOL, type CustomerWithAccounts } from './api';

type Tab = 'add' | 'open' | 'customers';
type Message = { kind: 'success' | 'error'; text: string } | null;

export function ManagerView({ onAuthError }: { onAuthError: (err: unknown) => boolean }) {
  const [tab, setTab] = useState<Tab>('customers');
  const [customers, setCustomers] = useState<CustomerWithAccounts[] | null>(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<Message>(null);

  const fail = useCallback(
    (err: unknown) => {
      if (!onAuthError(err)) setMessage({ kind: 'error', text: (err as Error).message });
    },
    [onAuthError],
  );

  const reload = useCallback(
    (term: string) =>
      api
        .customers(term)
        .then((r) => setCustomers(r.customers))
        .catch(fail),
    [fail],
  );

  // Search is done by the server; debounce the typing a little.
  useEffect(() => {
    const timer = setTimeout(() => reload(search), 200);
    return () => clearTimeout(timer);
  }, [search, reload]);

  function switchTab(next: Tab) {
    setMessage(null);
    setTab(next);
    if (next !== 'customers') setSearch('');
  }

  return (
    <div className="stack">
      <nav className="tabs" aria-label="Manager actions">
        {(
          [
            ['add', 'Add Customer'],
            ['open', 'Open Account'],
            ['customers', 'Customers'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} className={tab === key ? 'tab active' : 'tab'} onClick={() => switchTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {message && (
        <p className={`alert ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {tab === 'add' && <AddCustomer setMessage={setMessage} fail={fail} onDone={() => reload('')} />}
      {tab === 'open' && (
        <OpenAccount customers={customers ?? []} setMessage={setMessage} fail={fail} onDone={() => reload('')} />
      )}
      {tab === 'customers' && (
        <section className="card">
          <label htmlFor="search">Search customers</label>
          <input
            id="search"
            placeholder="Name or post code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!customers ? (
            <p className="muted">Loading…</p>
          ) : customers.length === 0 ? (
            <p className="muted">No customers found.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>First Name</th>
                    <th>Last Name</th>
                    <th>Post Code</th>
                    <th>Accounts</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td>{c.id}</td>
                      <td>{c.firstName}</td>
                      <td>{c.lastName}</td>
                      <td>{c.postCode}</td>
                      <td>
                        {c.accounts.length === 0
                          ? '—'
                          : c.accounts.map((a) => (
                              <div key={a.accountNumber}>
                                {a.accountNumber} · {SYMBOL[a.currency]}
                                {a.balance}
                              </div>
                            ))}
                      </td>
                      <td>
                        <button
                          className="danger"
                          onClick={async () => {
                            if (!window.confirm(`Delete ${c.firstName} ${c.lastName}?`)) return;
                            try {
                              await api.deleteCustomer(c.id);
                              setMessage({ kind: 'success', text: `Deleted ${c.firstName} ${c.lastName}` });
                              await reload(search);
                            } catch (err) {
                              fail(err);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

interface FormProps {
  setMessage: (m: Message) => void;
  fail: (err: unknown) => void;
  onDone: () => void;
}

function AddCustomer({ setMessage, fail, onDone }: FormProps) {
  const [form, setForm] = useState({ firstName: '', lastName: '', postCode: '' });
  const [busy, setBusy] = useState(false);
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { customer } = await api.addCustomer(form);
      setMessage({ kind: 'success', text: `Customer added successfully with customer id: ${customer.id}` });
      setForm({ firstName: '', lastName: '', postCode: '' });
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card narrow">
      <h3>Add Customer</h3>
      <form onSubmit={submit}>
        <label htmlFor="firstName">First Name</label>
        <input id="firstName" {...field('firstName')} />
        <label htmlFor="lastName">Last Name</label>
        <input id="lastName" {...field('lastName')} />
        <label htmlFor="postCode">Post Code</label>
        <input id="postCode" {...field('postCode')} />
        <button type="submit" disabled={busy}>
          Add Customer
        </button>
      </form>
    </section>
  );
}

function OpenAccount({ customers, setMessage, fail, onDone }: FormProps & { customers: CustomerWithAccounts[] }) {
  const [customerId, setCustomerId] = useState('');
  const [currency, setCurrency] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      // Sent as chosen; the server rejects a missing customer or unsupported currency.
      const { account } = await api.openAccount({ customerId: customerId ? Number(customerId) : null, currency });
      setMessage({
        kind: 'success',
        text: `Account created successfully with account number: ${account.accountNumber}`,
      });
      setCustomerId('');
      setCurrency('');
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card narrow">
      <h3>Open Account</h3>
      <form onSubmit={submit}>
        <label htmlFor="oa-customer">Customer</label>
        <select id="oa-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">— Customer name —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName}
            </option>
          ))}
        </select>
        <label htmlFor="oa-currency">Currency</label>
        <select id="oa-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="">— Currency —</option>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy}>
          Process
        </button>
      </form>
    </section>
  );
}
