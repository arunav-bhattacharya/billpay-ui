import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../appState'
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
 * What was done to the market, newest first, narrowed to one environment when [env] names one. The whole history
 * arrives in one request and is filtered here: it is tens of rows, and switching environments shouldn't cost a round
 * trip. It is read again whenever the market changes.
 */
export function RevisionHistory({ marketCode, env }: { marketCode: string; env: EnvStage | null }) {
  const { markets } = useApp()
  const updatedAt = markets.find((m) => m.market.code === marketCode)?.updatedAt
  const [revisions, setRevisions] = useState<MarketRevision[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRevisions(await api.revisions(marketCode))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [marketCode])

  useEffect(() => {
    void load()
  }, [load, updatedAt])

  const shown = useMemo(() => (env ? revisions?.filter((r) => r.envs.includes(env)) : revisions), [revisions, env])

  return (
    <div className="revisions card">
      <ErrorNote message={error} />
      {revisions === null && !error && <p className="muted">Loading history…</p>}
      {shown?.length === 0 && <p className="muted">Nothing has happened {env ? `in ${ENV_LABELS[env]} ` : ''}yet.</p>}
      {shown?.map((rev) => (
        <RevisionRow key={rev.id} revision={rev} />
      ))}
    </div>
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
