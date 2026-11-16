// Thin client for the XYZ Bank API. The browser holds no banking state of its
// own - only the session token. Everything shown on screen comes from the server.

export type Currency = 'Dollar' | 'Pound' | 'Rupee';
export const CURRENCIES: Currency[] = ['Dollar', 'Pound', 'Rupee'];
export const SYMBOL: Record<Currency, string> = { Dollar: '$', Pound: '£', Rupee: '₹' };

export interface Customer {
  id: number;
  firstName: string;
  lastName: string;
  postCode: string;
}
export interface Account {
  accountNumber: number;
  customerId: number;
  currency: Currency;
  balance: string;
  balanceMinor: number;
}
export interface Transaction {
  id: number;
  accountNumber: number;
  type: 'credit' | 'debit';
  amount: string;
  balanceAfter: string;
  createdAt: string;
}
export interface CustomerWithAccounts extends Customer {
  accounts: Account[];
}
export type Session = { role: 'manager' } | { role: 'customer'; customer: Customer };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'xyz-bank-token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null) =>
  token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Please try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  loginNames: () => call<{ customers: { id: number; name: string }[] }>('GET', '/auth/customers'),
  login: (body: { role: 'manager' } | { role: 'customer'; customerId: number }) =>
    call<{ token: string } & Session>('POST', '/auth/login', body),
  me: () => call<Session>('GET', '/me'),

  accounts: () => call<{ accounts: Account[] }>('GET', '/accounts'),
  deposit: (accountNumber: number, amount: string) =>
    call<{ account: Account; transaction: Transaction }>('POST', `/accounts/${accountNumber}/deposit`, { amount }),
  withdraw: (accountNumber: number, amount: string) =>
    call<{ account: Account; transaction: Transaction }>('POST', `/accounts/${accountNumber}/withdraw`, { amount }),
  transactions: (accountNumber: number) =>
    call<{ transactions: Transaction[]; total: number }>('GET', `/accounts/${accountNumber}/transactions?limit=200`),

  customers: (search: string) =>
    call<{ customers: CustomerWithAccounts[] }>('GET', `/manager/customers?search=${encodeURIComponent(search)}`),
  addCustomer: (body: { firstName: string; lastName: string; postCode: string }) =>
    call<{ customer: Customer }>('POST', '/manager/customers', body),
  openAccount: (body: { customerId: number | null; currency: string }) =>
    call<{ account: Account }>('POST', '/manager/accounts', body),
  deleteCustomer: (id: number) => call<void>('DELETE', `/manager/customers/${id}`),
};
