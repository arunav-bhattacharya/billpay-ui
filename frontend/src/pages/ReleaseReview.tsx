import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useApp } from '../AppContext'
import { ErrorNote, JsonDiff, Modal } from '../components'
import { TickIcon } from '../icons'
import { ACCOUNT_TYPE_LABELS, buildLabel, describeDuration, missingCombinations, parseDuration } from '../lib'
import { diffReleases } from '../releaseDiff'
import type { Change } from '../releaseDiff'
import { releaseBehavior } from '../schedule'
import type { MarketDocument, MarketProfile, ProfileReadiness, ReleaseConfig } from '../types'

/**
 * Before a release: the draft field by field against the version e1 runs, what the system checked, and who approves.
 * Freezing makes a version for good, so this is the one screen that shows exactly what it will be. The author can't
 * release their own change (maker-checker); the backend refuses it too.
 */
export function ReleaseReview({
  market,
  profile,
  readiness,
  version,
  onClose,
  onRelease,
}: {
  market: MarketDocument
  profile: MarketProfile
  readiness: ProfileReadiness
  version: number
  onClose: () => void
  onRelease: () => Promise<void>
}) {
  const { catalog, capabilities, role } = useApp()
  const [draft, setDraft] = useState<ReleaseConfig | null>(null)
  const [base, setBase] = useState<{ config: ReleaseConfig; label: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showJson, setShowJson] = useState(false)

  useEffect(() => {
    if (!profile.id) return
    const live = readiness.environments.find((e) => e.env === 'E1')?.live
    Promise.all([api.draft(market.market.code, profile.id), api.releases(market.market.code, profile.id)])
      .then(([d, releases]) => {
        setDraft(d)
        const against = releases.find((r) => r.version === live?.version) ?? releases[0]
        setBase(
          against
            ? { config: against.config, label: live?.version === against.version ? `v${against.version}, live in e1` : `v${against.version}, the newest release` }
            : { config: {}, label: 'nothing: the first release' },
        )
      })
      .catch((e: Error) => setError(e.message))
  }, [market.market.code, profile.id, readiness])

  const changes = useMemo(() => (draft && base ? diffReleases(base.config, draft, catalog) : []), [draft, base, catalog])
  const author = profile.editedBy ?? null
  const selfApproval = !!author && author.toUpperCase() === role
  const behavior = draft ? releaseBehavior(draft) : null
  const missing = behavior && capabilities ? missingCombinations(profile.accountType, behavior, capabilities) : []
  const window = parseDuration(draft?.cancellationWindow ?? 'PT1H')

  const checks: { ok: boolean | null; text: string; detail: string }[] = draft
    ? [
        capabilities
          ? {
              ok: missing.length === 0,
              text: missing.length === 0 ? `${buildLabel(capabilities)} runs every combination it needs` : `${buildLabel(capabilities)} lacks ${missing.length} combination${missing.length > 1 ? 's' : ''}`,
              detail: missing.length === 0 ? 'A pre-check; the release check in e1 is the full one.' : 'Its check would stop it, needing a build.',
            }
          : { ok: null, text: "e1's build couldn't be read", detail: 'The release check in e1 still runs.' },
        {
          ok: !!draft.timeZone,
          text: draft.timeZone ? `Runs at ${draft.executionTime ?? '00:00'} ${draft.timeZone}` : 'No time zone',
          detail: draft.timeZone ? 'Its Schedule is created when it activates.' : 'Its scheduled payments would get 422 NOT_ONBOARDED.',
        },
        {
          ok: !!window && window.amount > 0,
          text: !!window && window.amount > 0 ? `Cancels close ${describeDuration(draft.cancellationWindow ?? 'PT1H')} before the run` : 'The cancellation window never closes before the run',
          detail: !!window && window.amount > 0 ? 'Checked again in e1.' : 'Its check would stop it.',
        },
        ...(behavior && behavior.requiresBankConfirmation !== 'N'
          ? [
              {
                ok: !!(draft.bankConfirmation as { confirmationWindow?: string } | undefined)?.confirmationWindow,
                text: 'Bank confirmation has a confirmation window',
                detail: 'Without one, a payment waiting for its bank gets 422.',
              },
            ]
          : []),
        { ok: true, text: 'Payments already running keep their version', detail: `New payments take v${version} once it is active.` },
      ]
    : []

  async function release() {
    setBusy(true)
    setError(null)
    try {
      await onRelease()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const groups: Change['group'][] = ['APIs', 'Behaviors', 'Operations']
  return (
    <Modal title={`Release ${market.market.name} · ${ACCOUNT_TYPE_LABELS[profile.accountType]} · v${version}`} onClose={onClose} wide>
      <div className="review">
        <div className="review-main">
          <p className="review-against">
            Against {base?.label ?? '…'} · <b>{changes.length}</b> change{changes.length === 1 ? '' : 's'}
          </p>
          {draft === null && !error && <p className="muted">Reading the draft…</p>}
          {draft && changes.length === 0 && <p className="muted">The draft matches that version.</p>}
          {groups.map((g) => {
            const rows = changes.filter((c) => c.group === g)
            if (rows.length === 0) return null
            return (
              <section key={g} className="diff-group">
                <h4>
                  {g} <span>{rows.length} changed</span>
                </h4>
                {rows.map((c) => (
                  <div key={c.key} className="diff-row">
                    <div className="diff-k">
                      {c.label}
                      <small>{c.key}</small>
                    </div>
                    <div className={`diff-was ${c.before === null || c.before === 'not taken' ? 'none' : ''}`}>{c.before ?? 'unset'}</div>
                    <div className="diff-to" aria-hidden="true">→</div>
                    <div className={`diff-now ${c.after === null || c.after === 'not taken' ? 'none' : ''}`}>{c.after ?? 'unset'}</div>
                  </div>
                ))}
              </section>
            )
          })}
          {draft && base && (
            <details className="review-json" open={showJson} onToggle={(e) => setShowJson((e.currentTarget as HTMLDetailsElement).open)}>
              <summary>The release JSON, line by line</summary>
              <JsonDiff before={JSON.stringify(base.config)} after={JSON.stringify(draft)} />
            </details>
          )}
        </div>

        <aside className="review-side">
          <section>
            <h4>Before it goes</h4>
            {checks.map((c) => (
              <div key={c.text} className="chk">
                <i className={c.ok === null ? 'q' : c.ok ? 'ok' : 'no'}>{c.ok === null ? '?' : c.ok ? <TickIcon /> : '!'}</i>
                <div>
                  {c.text}
                  <small>{c.detail}</small>
                </div>
              </div>
            ))}
          </section>
          <section>
            <h4>Maker and checker</h4>
            <div className="people">
              <div className="person">
                <span className="role">Author</span>
                <b>{author ?? 'not recorded'}</b>
              </div>
              <div className="person">
                <span className="role">Approver</span>
                <b>{role} · you</b>
              </div>
            </div>
            <p className={`rule ${selfApproval ? 'blocked' : ''}`}>
              {selfApproval
                ? `${role} made the last change, so someone else approves it. Switch roles in the top bar to act as the checker.`
                : `Releasing freezes v${version} for good and sends it to e1. Your role is recorded as its approver.`}
            </p>
            <ErrorNote message={error} />
            <button className="btn primary review-go" disabled={busy || selfApproval || !draft} onClick={release}>
              {busy ? 'Releasing…' : `Approve and release v${version} to e1`}
            </button>
          </section>
        </aside>
      </div>
    </Modal>
  )
}
