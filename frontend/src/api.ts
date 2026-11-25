import type {
  AccountType,
  Capabilities,
  Catalog,
  EnvironmentInfo,
  EnvStage,
  LiveRelease,
  MarketDocument,
  MarketRevision,
  ReleaseConfig,
  ReleaseView,
  Role,
} from './types'

/**
 * The app has no authentication. The revision history still wants to say who acted, so every call carries the UI's
 * current role, kept here at module scope because `request` is not a hook and cannot read context.
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

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

const profilePath = (code: string, profileId: string) => `/api/markets/${code}/profiles/${profileId}`

export const api = {
  setRole: (role: Role) => {
    currentRole = role
  },
  catalog: () => request<Catalog>('/api/catalog'),
  environments: () => request<EnvironmentInfo[]>('/api/environments'),
  capabilities: (env: EnvStage) => request<Capabilities>(`/api/environments/${env}/capabilities`),
  /** Every market and account type live in `env`, with the release JSON it runs. */
  live: (env: EnvStage) => request<LiveRelease[]>(`/api/environments/${env}/live`),
  markets: () => request<MarketDocument[]>('/api/markets'),
  revisions: (code: string) => request<MarketRevision[]>(`/api/markets/${code}/revisions`),
  createMarket: (doc: MarketDocument) => post<MarketDocument>('/api/markets', doc),
  updateMarket: (code: string, doc: MarketDocument) =>
    request<MarketDocument>(`/api/markets/${code}`, { method: 'PUT', body: JSON.stringify(doc) }),
  deleteMarket: (code: string) => request<void>(`/api/markets/${code}`, { method: 'DELETE' }),
  deleteProfile: (code: string, profileId: string) =>
    request<MarketDocument>(profilePath(code, profileId), { method: 'DELETE' }),
  clone: (code: string, targetCode: string, accountTypes?: AccountType[]) =>
    post<MarketDocument>(`/api/markets/${code}/clone`, { targetCode, accountTypes: accountTypes ?? null }),

  // ---- releases ----
  releases: (code: string, profileId: string) =>
    request<ReleaseView[]>(`${profilePath(code, profileId)}/releases`),
  /** The release JSON the draft would freeze as now. */
  draft: (code: string, profileId: string) => request<ReleaseConfig>(`${profilePath(code, profileId)}/draft`),
  /** Freezes the draft as the next version and sends it to e1. */
  release: (code: string, profileId: string) =>
    post<MarketDocument>(`${profilePath(code, profileId)}/release`),
  /** Sends the version live in `env` to the next environment. */
  promote: (code: string, profileId: string, env: EnvStage) =>
    post<MarketDocument>(`${profilePath(code, profileId)}/environments/${env}/promote`),
  signOff: (code: string, profileId: string, env: EnvStage) =>
    post<MarketDocument>(`${profilePath(code, profileId)}/environments/${env}/sign-off`),
  /** Validates the number with ServiceNow; only an approved one is recorded on the release in e3. */
  recordRfc: (code: string, profileId: string, rfcNumber: string) =>
    post<MarketDocument>(`${profilePath(code, profileId)}/rfc`, { rfcNumber }),
  rollback: (code: string, profileId: string, env: EnvStage, reason?: string) =>
    post<MarketDocument>(`${profilePath(code, profileId)}/environments/${env}/rollback`, { reason }),
  pause: (code: string, profileId: string, env: EnvStage, reason?: string) =>
    post<MarketDocument>(`${profilePath(code, profileId)}/environments/${env}/pause`, { reason }),
  resume: (code: string, profileId: string, env: EnvStage, reason?: string) =>
    post<MarketDocument>(`${profilePath(code, profileId)}/environments/${env}/resume`, { reason }),
}
