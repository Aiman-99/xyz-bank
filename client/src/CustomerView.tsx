import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
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

/**
 * The field takes 10 integer digits plus 2 for cents. The server's limit is
 * 1,000,000,000.00 (one billion) and it rejects anything above that.
 */
const MAX_DIGITS = 12;

/** Keep only digits, drop leading zeros, cap the length. "00.010" -> "10", "abc" -> "". */
function toDigits(text: string): string {
  return text.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITS);
}

/** "" -> "00.00", "1" -> "00.01", "10" -> "00.10", "12345" -> "123.45". String-only, no floats. */
function formatDigits(digits: string): string {
  const padded = digits.padStart(4, '0');
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
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
  // The field holds whole minor units (cents) as a string of digits - never a decimal
  // number. Digits enter from the right, like a card terminal: 1 -> 00.01, then 0 -> 00.10.
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = `amount-${title.toLowerCase()}`;
  const display = formatDigits(digits);

  const caretToEnd = () => {
    const el = inputRef.current;
    if (el && document.activeElement === el) el.setSelectionRange(el.value.length, el.value.length);
  };
  // Keep the caret at the end so typing and Backspace always act on the last digit.
  useLayoutEffect(caretToEnd, [display]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    // The server still validates the amount (zero, too large, ...) - this field only shapes input.
    if (await onSubmit(display)) setDigits('');
    setBusy(false);
  }

  return (
    <section className="card">
      <h3>{title}</h3>
      <form onSubmit={submit}>
        <label htmlFor={id}>Amount</label>
        <input
          id={id}
          ref={inputRef}
          className="amount"
          inputMode="numeric"
          autoComplete="off"
          value={display}
          onChange={(e) => setDigits(toDigits(e.target.value))}
          onFocus={caretToEnd}
          onClick={caretToEnd}
        />
        <button type="submit" disabled={busy}>
          {action}
        </button>
      </form>
    </section>
  );
}
