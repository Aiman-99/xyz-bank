import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, SYMBOL, type Account, type Customer, type Transaction } from './api';

type Message = { kind: 'success' | 'error'; text: string } | null;

export function CustomerView({
  customer,
  onAuthError,
}: {
  customer: Customer;
  onAuthError: (err: unknown) => boolean;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [message, setMessage] = useState<Message>(null);

  const fail = useCallback(
    (err: unknown) => {
      if (!onAuthError(err)) setMessage({ kind: 'error', text: (err as Error).message });
    },
    [onAuthError],
  );

  useEffect(() => {
    api
      .accounts()
      .then((r) => {
        setAccounts(r.accounts);
        setSelected((current) => current ?? r.accounts[0]?.accountNumber ?? null);
      })
      .catch(fail);
  }, [fail]);

  const loadTransactions = useCallback(
    (accountNumber: number) =>
      api
        .transactions(accountNumber)
        .then((r) => setTransactions(r.transactions))
        .catch(fail),
    [fail],
  );

  useEffect(() => {
    setTransactions([]);
    if (selected !== null) loadTransactions(selected);
  }, [selected, loadTransactions]);

  const account = accounts?.find((a) => a.accountNumber === selected);

  async function move(kind: 'deposit' | 'withdraw', amount: string) {
    if (!account) return false;
    setMessage(null);
    try {
      // The server validates the amount, applies it and returns the new balance.
      const result = await api[kind](account.accountNumber, amount);
      setAccounts((list) => list!.map((a) => (a.accountNumber === result.account.accountNumber ? result.account : a)));
      setMessage({
        kind: 'success',
        text: `${kind === 'deposit' ? 'Deposit' : 'Withdrawal'} of ${SYMBOL[result.account.currency]}${result.transaction.amount} successful`,
      });
      await loadTransactions(account.accountNumber);
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  if (!accounts) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <h2>Welcome, {customer.firstName} {customer.lastName}</h2>

      {accounts.length === 0 || !account ? (
        <p className="alert info">You have no account yet. Please ask the bank manager to open one for you.</p>
      ) : (
        <>
          <section className="card">
            {accounts.length > 1 && (
              <div className="field-inline">
                <label htmlFor="account">Account</label>
                <select
                  id="account"
                  value={account.accountNumber}
                  onChange={(e) => {
                    setMessage(null);
                    setSelected(Number(e.target.value));
                  }}
                >
                  {accounts.map((a) => (
                    <option key={a.accountNumber} value={a.accountNumber}>
                      {a.accountNumber} ({a.currency})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <dl className="summary">
              <div>
                <dt>Account Number</dt>
                <dd>{account.accountNumber}</dd>
              </div>
              <div>
                <dt>Balance</dt>
                <dd data-testid="balance">
                  {SYMBOL[account.currency]}
                  {account.balance}
                </dd>
              </div>
              <div>
                <dt>Currency</dt>
                <dd>{account.currency}</dd>
              </div>
            </dl>
          </section>

          {message && (
            <p className={`alert ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
              {message.text}
            </p>
          )}

          <div className="two-col">
            <AmountForm title="Deposit" action="Deposit" onSubmit={(amount) => move('deposit', amount)} />
            <AmountForm title="Withdraw" action="Withdraw" onSubmit={(amount) => move('withdraw', amount)} />
          </div>

          <section className="card">
            <h3>Transactions</h3>
            {transactions.length === 0 ? (
              <p className="muted">No transactions yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date-Time</th>
                      <th>Type</th>
                      <th className="num">Amount</th>
                      <th className="num">Balance after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id}>
                        <td>{new Date(t.createdAt).toLocaleString()}</td>
                        <td>
                          <span className={`badge ${t.type}`}>{t.type === 'credit' ? 'Credit' : 'Debit'}</span>
                        </td>
                        <td className="num">{t.amount}</td>
                        <td className="num">{t.balanceAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {(accounts.length === 0 || !account) && message && <p className={`alert ${message.kind}`}>{message.text}</p>}
    </div>
  );
}

function AmountForm({
  title,
  action,
  onSubmit,
}: {
  title: string;
  action: string;
  onSubmit: (amount: string) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const id = `amount-${title.toLowerCase()}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    // The raw text is sent as-is; the server is the one that validates it.
    if (await onSubmit(amount)) setAmount('');
    setBusy(false);
  }

  return (
    <section className="card">
      <h3>{title}</h3>
      <form onSubmit={submit}>
        <label htmlFor={id}>Amount</label>
        <input
          id={id}
          inputMode="decimal"
          placeholder="0.00"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {action}
        </button>
      </form>
    </section>
  );
}
