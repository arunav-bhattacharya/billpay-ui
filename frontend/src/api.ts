import type { Catalog, MarketDocument } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
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
  catalog: () => request<Catalog>('/api/catalog'),
  markets: () => request<MarketDocument[]>('/api/markets'),
  market: (code: string) => request<MarketDocument>(`/api/markets/${code}`),
  createMarket: (doc: MarketDocument) =>
    request<MarketDocument>('/api/markets', { method: 'POST', body: JSON.stringify(doc) }),
  updateMarket: (code: string, doc: MarketDocument) =>
    request<MarketDocument>(`/api/markets/${code}`, { method: 'PUT', body: JSON.stringify(doc) }),
  deleteMarket: (code: string) =>
    request<void>(`/api/markets/${code}`, { method: 'DELETE' }),
  activate: (code: string, profileId?: string) =>
    request<MarketDocument>(`/api/markets/${code}/activate`, {
      method: 'POST',
      body: JSON.stringify({ profileId: profileId ?? null }),
    }),
  clone: (code: string, targetCode: string) =>
    request<MarketDocument>(`/api/markets/${code}/clone`, {
      method: 'POST',
      body: JSON.stringify({ targetCode }),
    }),
}
