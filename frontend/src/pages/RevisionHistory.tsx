import { useCallback, useMemo, useState } from 'react'
import { api } from '../api'
import { ErrorNote, JsonDiff } from '../components'
import { ENV_LABELS, formatDateTime, formatRelative } from '../lib'
import type { EnvStage, MarketRevision, RevisionAction } from '../types'

const ACTION_LABELS: Record<RevisionAction, string> = {
  CREATED: 'Onboarded',
  UPDATED: 'Updated',
  RELEASED: 'Released',
  PROMOTED: 'Promoted',
  VERIFIED: 'Signed off',
  RFC_RECORDED: 'Change request',
  ACTIVATED: 'Activated',
  FAILED: 'Failed',
  REFUSED: 'Refused',
  ROLLED_BACK: 'Rolled back',
  PAUSED: 'Paused',
  RESUMED: 'Resumed',
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
