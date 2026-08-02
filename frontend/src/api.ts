import type { AccountType, Catalog, MarketDocument, MarketRevision, Role } from './types'

/**
 * The app has no authentication. The revision history still wants to say who
 * acted, so every mutating call carries the UI's current role — kept here at
 * module scope because `request` is not a hook and cannot read context.
 */
let currentRole: Role = 'OPERATOR'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'X-Billpay-Role': currentRole },
    ...init,
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  setRole: (role: Role) => {
    currentRole = role
  },
  catalog: () => request<Catalog>('/api/catalog'),
  markets: () => request<MarketDocument[]>('/api/markets'),
  revisions: (code: string) => request<MarketRevision[]>(`/api/markets/${code}/revisions`),
  createMarket: (doc: MarketDocument) =>
    request<MarketDocument>('/api/markets', { method: 'POST', body: JSON.stringify(doc) }),
  updateMarket: (code: string, doc: MarketDocument) =>
    request<MarketDocument>(`/api/markets/${code}`, { method: 'PUT', body: JSON.stringify(doc) }),
  deleteMarket: (code: string) =>
    request<void>(`/api/markets/${code}`, { method: 'DELETE' }),
  promoteProfile: (code: string, profileId: string) =>
    request<MarketDocument>(`/api/markets/${code}/profiles/${profileId}/promote`, {
      method: 'POST',
    }),
  verifyProfile: (code: string, profileId: string) =>
    request<MarketDocument>(`/api/markets/${code}/profiles/${profileId}/verify`, {
      method: 'POST',
    }),
  /** Validates the number with ServiceNow; only an approved one is recorded. */
  recordRfc: (code: string, profileId: string, rfcNumber: string) =>
    request<MarketDocument>(`/api/markets/${code}/profiles/${profileId}/rfc`, {
      method: 'POST',
      body: JSON.stringify({ rfcNumber }),
    }),
  deleteProfile: (code: string, profileId: string) =>
    request<MarketDocument>(`/api/markets/${code}/profiles/${profileId}`, { method: 'DELETE' }),
  clone: (code: string, targetCode: string, accountTypes?: AccountType[]) =>
    request<MarketDocument>(`/api/markets/${code}/clone`, {
      method: 'POST',
      body: JSON.stringify({ targetCode, accountTypes: accountTypes ?? null }),
    }),
}
