import { useCallback, useMemo, useState } from 'react'
import { api } from '../api'
import { ErrorNote } from '../components'
import { ENV_LABELS, formatDateTime, formatRelative } from '../lib'
import type { EnvStage, MarketRevision, RevisionAction } from '../types'

const ACTION_LABELS: Record<RevisionAction, string> = {
  CREATED: 'Onboarded',
  UPDATED: 'Updated',
  PROMOTED: 'Promoted',
  VERIFIED: 'Verified',
  RFC_RECORDED: 'Change request',
  PROFILE_DELETED: 'Profile removed',
  CLONED: 'Cloned',
}

/**
 * What was done to this market in one environment.
 *
 * The whole history arrives in a single request and is filtered here: it is
 * tens of rows, and switching environments should not cost a round trip.
 * Collapsed on arrival and fetched on first open — most visits to a market
 * page are not about the history, so it should not cost a request until
 * someone asks.
 */
export function RevisionHistory({ marketCode, env }: { marketCode: string; env: EnvStage }) {
  const [revisions, setRevisions] = useState<MarketRevision[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRevisions(await api.revisions(marketCode))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [marketCode])

  const inEnv = useMemo(
    () => revisions?.filter((r) => r.envs.includes(env)),
    [revisions, env],
  )

  return (
    <details
      className="revisions"
      onToggle={(e) => {
        // Re-fetch on every open: promoting or editing while the section sits
        // collapsed would otherwise leave a stale list behind it.
        if ((e.currentTarget as HTMLDetailsElement).open) void load()
      }}
    >
      <summary>
        Revision history
        {inEnv && <span className="rev-count">{inEnv.length}</span>}
      </summary>

      <div className="revisions-body">
        <ErrorNote message={error} />
        {loading && revisions === null && <p className="muted">Loading history…</p>}
        {inEnv?.length === 0 && (
          <p className="muted">Nothing has been changed in {ENV_LABELS[env]} yet.</p>
        )}
        {inEnv?.map((rev) => (
          <RevisionRow key={rev.id} revision={rev} />
        ))}
      </div>
    </details>
  )
}

function RevisionRow({ revision }: { revision: MarketRevision }) {
  const hasDiff = Boolean(revision.beforeJson || revision.afterJson)
  return (
    <article className={`rev-row act-${revision.action.toLowerCase().replace(/_/g, '-')}`}>
      <div className="rev-head">
        <span className="rev-action">{ACTION_LABELS[revision.action]}</span>
        <span className="rev-summary">{revision.summary}</span>
        <span className="rev-actor" title={`Acted as ${revision.actor}`}>
          {revision.actor}
        </span>
      </div>
      <p className="rev-when">
        <time dateTime={revision.at}>{formatDateTime(revision.at)}</time>
        <span className="rev-ago">{formatRelative(revision.at)}</span>
      </p>
      {hasDiff && (
        <details className="rev-diff">
          <summary>Changes</summary>
          <JsonDiff before={revision.beforeJson} after={revision.afterJson} />
        </details>
      )}
    </article>
  )
}

/**
 * Only what changed. Two full documents side by side made the reader do the
 * diffing; this does it for them and keeps a couple of lines either side so
 * each change can still be placed in the document.
 */
function JsonDiff({ before, after }: { before?: string | null; after?: string | null }) {
  const rows = useMemo(
    () => diffJson(pretty(before), pretty(after)),
    [before, after],
  )
  if (rows.length === 0) return <p className="muted rev-diff-empty">No field-level changes.</p>
  return (
    <div className="json-block rev-diff-block">
      <pre>
        {rows.map((row, i) =>
          row.type === 'gap' ? (
            <span key={i} className="jd-gap">
              ⋯
            </span>
          ) : (
            <span key={i} className={`jd-line jd-${row.type}`}>
              <span className="jd-sign" aria-hidden="true">
                {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}
              </span>
              {row.text}
            </span>
          ),
        )}
      </pre>
    </div>
  )
}

type DiffRow = { type: 'add' | 'del' | 'ctx' | 'gap'; text: string }

/** Lines of unchanged JSON kept either side of a change, for orientation. */
const CONTEXT = 2

function diffJson(before: string, after: string): DiffRow[] {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []

  // Longest common subsequence over lines — the documents are tens of lines,
  // so the quadratic table is far cheaper than pulling in a diff library.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ type: 'ctx', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: 'del', text: a[i++] })
    } else {
      rows.push({ type: 'add', text: b[j++] })
    }
  }
  while (i < a.length) rows.push({ type: 'del', text: a[i++] })
  while (j < b.length) rows.push({ type: 'add', text: b[j++] })

  return collapse(rows)
}

/** Drop long stretches of untouched lines, marking where they were elided. */
function collapse(rows: DiffRow[]): DiffRow[] {
  const keep = rows.map(
    (row, i) =>
      row.type !== 'ctx' ||
      rows.some((r, k) => r.type !== 'ctx' && Math.abs(k - i) <= CONTEXT),
  )
  if (!keep.some(Boolean)) return []

  const out: DiffRow[] = []
  let elided = false
  rows.forEach((row, i) => {
    if (keep[i]) {
      if (elided) out.push({ type: 'gap', text: '' })
      elided = false
      out.push(row)
    } else {
      elided = true
    }
  })
  return out
}

/** Stored compact; shown indented. Falls back to the raw string if it will not parse. */
function pretty(json?: string | null): string {
  if (!json) return ''
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}
