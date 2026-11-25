import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../AppContext'
import {
  BehaviorRow,
  CustomBehaviorDefForm,
  CustomBehaviorRow,
} from '../behavior'
import { ApiIdentity, CloneDialog, ErrorNote, JsonView, StatusSeal } from '../components'
import { Arrow, CopyIcon, Flag, PencilIcon, TrashIcon } from '../icons'
import {
  ACCOUNT_TYPE_LABELS,
  BEHAVIOR_VALUE_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  ENV_LABELS,
  ENV_NAMES,
  ENV_ORDER,
  formatRelative,
  missingCombinations,
  operationsSummary,
  projectToEnv,
  reaches,
  yn,
} from '../lib'
import { OperationsEditor } from '../operations'
import type {
  AccountType,
  Behavior,
  CustomBehaviorDef,
  EnvStage,
  MarketDocument,
  MarketProfile,
  MarketRevision,
  OperationsSettings,
  ProfileReadiness,
} from '../types'
import { EnvironmentReadiness } from './EnvironmentReadiness'
import { ReleaseReview } from './ReleaseReview'
import { RevisionHistory } from './RevisionHistory'

/** One market, in full: each account type carries its own readiness and profile. */
export function MarketPage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { markets, catalog, loading, loadError, refreshMarkets } = useApp()
  const [showClone, setShowClone] = useState(false)
  const [confirmDeleteMarket, setConfirmDeleteMarket] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const market = markets.find((m) => m.market.code === code?.toUpperCase())

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refreshMarkets()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // A direct hit on /markets/XX arrives before the market list does.
  if (loading) {
    return (
      <main className="page">
        <p className="muted">Loading market…</p>
      </main>
    )
  }
  if (!market) {
    // A failed list request leaves `markets` empty, which looks exactly like a
    // market that does not exist. Say which one actually happened.
    return (
      <main className="page">
        <div className="empty-state">
          <h2>{loadError ? 'Markets did not load' : 'No such market'}</h2>
          <p>
            {loadError ?? (
              <>
                {code?.toUpperCase()} is not onboarded — it may have been removed, or the code
                may be wrong.
              </>
            )}
          </p>
          {loadError ? (
            <button
              className="btn primary"
              /* refreshMarkets records the failure itself; swallowing the
                 rejection here keeps it from surfacing as unhandled. */
              onClick={() => refreshMarkets().catch(() => {})}
            >
              Try again
            </button>
          ) : (
            <Link className="btn primary" to="/">
              Back to markets
            </Link>
          )}
        </div>
      </main>
    )
  }

  // Not every market takes all three account types — Denmark, Poland and
  // Czechia are Corporate only — so "can add" is measured against what this
  // market actually supports, not a flat three.
  const curated = catalog?.markets.find((m) => m.code === market.market.code)
  const allowedTypes = curated?.allowedAccountTypes?.length
    ? curated.allowedAccountTypes.length
    : (catalog?.accountTypes.length ?? 3)
  const canAddType = market.profiles.length < allowedTypes

  return (
    <main className={`page market-page region-${market.market.region.toLowerCase()}`}>
      <Link className="btn back-link" to="/">
        <Arrow direction="left" />
        Markets
      </Link>

      <header className="market-banner">
        <Flag code={market.market.code} size={34} />
        <div className="market-banner-id">
          <h1>{market.market.name}</h1>
          <span className="market-banner-code mono-tag">
            {market.market.code} · {market.market.currency} · {market.market.region}
          </span>
        </div>
        <StatusSeal status={market.status} onDark />
      </header>

      {confirmDeleteMarket && (
        <div className="confirm-bar" role="alertdialog" aria-label="Confirm market removal">
          <span>
            Remove <strong>{market.market.name}</strong> and all {market.profiles.length} of its
            profiles?
          </span>
          <button
            className="btn sm danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.deleteMarket(market.market.code)
                navigate('/', { replace: true })
              })
            }
          >
            Yes, remove market
          </button>
          <button className="btn sm ghost" onClick={() => setConfirmDeleteMarket(false)}>
            Cancel
          </button>
        </div>
      )}

      <ErrorNote message={error} />

      <div className="profiles-head">
        <h2>Profiles</h2>
        <span
          className="profiles-count"
          title={`${market.profiles.length} of ${allowedTypes} ${
            allowedTypes === 1 ? 'account type' : 'account types'
          } onboarded`}
        >
          {market.profiles.length} of {allowedTypes}
        </span>
        {/* Everything that acts on the run of profiles below sits in its
            heading, rather than floating in a row of its own. Grouped so the
            set stays right-aligned however many of them render. */}
        <div className="profiles-actions">
          {canAddType && (
            <button
              className="btn navy lg"
              onClick={() => navigate(`/onboard/${market.market.code}`)}
            >
              + Account Profile
            </button>
          )}
          <button
            className="act-btn act-blue"
            title="Clone this market's setup to another market"
            aria-label="Clone market"
            onClick={() => setShowClone(true)}
          >
            <CopyIcon />
          </button>
          <button
            className="act-btn act-red"
            title="Delete market"
            aria-label="Delete market"
            disabled={busy}
            onClick={() => setConfirmDeleteMarket(true)}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {market.profiles.length === 0 && (
        <p className="muted">No profiles yet — add an account type to get started.</p>
      )}

      {market.profiles.map((p) => (
        <AccountTypeSection
          key={p.id ?? p.accountType}
          market={market}
          profile={p}
          busy={busy}
          run={run}
          onDelete={() => p.id && run(() => api.deleteProfile(market.market.code, p.id!))}
        />
      ))}

      <EnvironmentRecord market={market} />

      {showClone && (
        <CloneDialog
          source={market}
          onClose={() => setShowClone(false)}
          onDone={(target) => {
            setShowClone(false)
            navigate(`/markets/${target}`)
          }}
        />
      )}
    </main>
  )
}

/**
 * The market as a single environment holds it — what is configured there, and
 * what has been done to it.
 *
 * One selector rather than one per card: both answer the same question about
 * the same environment, and reading them against different ones would be a
 * trap rather than a feature.
 */
function EnvironmentRecord({ market }: { market: MarketDocument }) {
  // Opens on the furthest environment the market has reached — where the work
  // most recently happened, and where anyone arriving is most likely headed.
  const [env, setEnv] = useState<EnvStage>(market.status)

  const document = projectToEnv(market, env)
  const present = document.profiles.length

  return (
    <>
      {/* Named in the page like the Profiles heading above it, with what it
          holds and the control that scopes it stacked underneath. */}
      <div className="env-record-head">
        <h2>Environment record</h2>
        <p className="env-record-lede">
          Each environment holds its own configuration and history.
        </p>
        <div className="env-tabs" role="tablist" aria-label="Environment">
          {ENV_ORDER.map((e) => {
            const count = market.profiles.filter((p) => reaches(p.status, e)).length
            return (
              <button
                key={e}
                role="tab"
                aria-selected={e === env}
                className={`env-tab ${e === env ? 'on' : ''} ${count === 0 ? 'empty' : ''}`}
                /* The readiness columns above spell the environments out, so
                   the selector only has to name them. */
                title={ENV_NAMES[e]}
                onClick={() => setEnv(e)}
              >
                {e}
              </button>
            )
          })}
        </div>
      </div>

      <section className="env-record">
        {present === 0 ? (
          <p className="muted env-record-empty">
            Nothing has reached {ENV_LABELS[env]} yet — promote a profile to open its record here.
          </p>
        ) : (
          <>
            <RevisionHistory marketCode={market.market.code} env={env} />
            <JsonView
              data={document}
              filename={`${market.market.code.toLowerCase()}-${ENV_LABELS[env]}.json`}
            />
          </>
        )}
      </section>
    </>
  )
}

/**
 * Everything about one account type in one place: how far it has got in each
 * environment, and the configuration that got it there.
 */
function AccountTypeSection({
  market,
  profile,
  busy,
  run,
  onDelete,
}: {
  market: MarketDocument
  profile: MarketProfile
  busy: boolean
  run: (a: () => Promise<unknown>) => Promise<void>
  onDelete: () => void
}) {
  const { catalog, environments, capabilities, refreshMarkets } = useApp()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showCloneTargets, setShowCloneTargets] = useState(false)
  const [editing, setEditing] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const readiness = market.readiness?.find((r) => r.profileId === profile.id)

  // Account types this profile could be cloned to: allowed for the market
  // and not already carrying a profile.
  const curated = catalog?.markets.find((m) => m.code === market.market.code)
  const allowedTypes: AccountType[] = curated?.allowedAccountTypes?.length
    ? curated.allowedAccountTypes
    : (catalog?.accountTypes ?? []).map((t) => t.key)
  const cloneTargets = allowedTypes.filter(
    (t) => !market.profiles.some((p) => p.accountType === t),
  )

  function cloneTo(target: AccountType) {
    setShowCloneTargets(false)
    // The test accounts are this profile's own mock accounts, so they stay behind.
    const copy: MarketProfile = {
      accountType: target,
      status: 'E1',
      apis: [...profile.apis],
      dimensions: { ...profile.dimensions },
      customDimensions: { ...profile.customDimensions },
      operations: { ...profile.operations, testAccounts: [] },
    }
    run(() =>
      api.updateMarket(market.market.code, { ...market, profiles: [...market.profiles, copy] }),
    )
  }

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    apis: (catalog?.apis ?? []).filter(
      (a) => a.category === cat && profile.apis.includes(a.name),
    ),
  })).filter((g) => g.apis.length > 0)

  const behaviors = catalog?.behaviors ?? []
  const code = market.market.code
  const id = profile.id!
  const missing = capabilities ? missingCombinations(profile.accountType, profile.dimensions, capabilities) : []

  // Editing always shows the profile — hiding what you are changing is no help.
  const profileVisible = profileOpen || editing

  return (
    <section className="acct-section">
      <header className="acct-head">
        <h2>{ACCOUNT_TYPE_LABELS[profile.accountType]}</h2>
        <StatusSeal status={profile.status} small />
      </header>

      {showCloneTargets && (
        <div className="confirm-bar" role="dialog" aria-label="Clone profile to another account type">
          <span>
            Copy the <strong>{ACCOUNT_TYPE_LABELS[profile.accountType]}</strong> setup to:
          </span>
          {cloneTargets.map((t) => (
            <button key={t} className="btn sm primary" disabled={busy} onClick={() => cloneTo(t)}>
              {ACCOUNT_TYPE_LABELS[t]}
            </button>
          ))}
          <button className="btn sm ghost" onClick={() => setShowCloneTargets(false)}>
            Cancel
          </button>
        </div>
      )}

      {confirmDelete && (
        <div className="confirm-bar" role="alertdialog" aria-label="Confirm profile removal">
          <span>
            Remove the <strong>{ACCOUNT_TYPE_LABELS[profile.accountType]}</strong> profile from{' '}
            {market.market.name}?
          </span>
          <button
            className="btn sm danger"
            disabled={busy}
            onClick={() => {
              setConfirmDelete(false)
              onDelete()
            }}
          >
            Yes, remove profile
          </button>
          <button className="btn sm ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      )}

      <div className="acct-block">
        <h3 className="block-title">Environments</h3>
        {readiness && (
          <DraftBar
            market={market}
            profile={profile}
            readiness={readiness}
            busy={busy}
            missing={missing.length}
            onRelease={() => api.release(code, id).then(() => refreshMarkets())}
          />
        )}
        <div className="acct-board">
          {readiness ? (
            <EnvironmentReadiness
              market={market}
              profile={profile}
              readiness={readiness}
              environments={environments}
              actions={{
                busy,
                onSignOff: (env) => run(() => api.signOff(code, id, env)),
                onRecordRfc: (rfcNumber) => run(() => api.recordRfc(code, id, rfcNumber)),
                onPromote: (env) => run(() => api.promote(code, id, env)),
                onRollback: (env, reason) => run(() => api.rollback(code, id, env, reason)),
                onPause: (env, reason) => run(() => api.pause(code, id, env, reason)),
                onResume: (env, reason) => run(() => api.resume(code, id, env, reason)),
              }}
            />
          ) : (
            <p className="muted">Readiness is unavailable for this profile.</p>
          )}
          <Activity market={market} profile={profile} />
        </div>
      </div>

      <div className="acct-block">
        {/* The profile's own actions belong to the profile, so they sit on its
            row rather than in the account-type header — and stay there
            collapsed, since deleting or cloning should not cost an expand. */}
        <div className="block-head">
          <button
            className={`block-toggle ${profileVisible ? 'open' : ''}`}
            aria-expanded={profileVisible}
            onClick={() => setProfileOpen((v) => !v)}
          >
            <span className="chevron" aria-hidden="true" />
            <span className="block-title">Account profile</span>
          </button>

          <div className="block-actions">
            <button
              className="act-btn act-blue"
              title="Edit profile"
              aria-label={`Edit ${ACCOUNT_TYPE_LABELS[profile.accountType]} profile`}
              disabled={busy}
              /* Editing implies showing: `profileVisible` already follows
                 `editing`, so a collapsed row opens itself. */
              onClick={() => setEditing(true)}
            >
              <PencilIcon />
            </button>
            {cloneTargets.length > 0 && (
              <button
                className="act-btn act-blue"
                title="Clone to another account type"
                aria-label={`Clone ${ACCOUNT_TYPE_LABELS[profile.accountType]} profile to another account type`}
                disabled={busy}
                onClick={() => setShowCloneTargets((v) => !v)}
              >
                <CopyIcon />
              </button>
            )}
            <button
              className="act-btn act-red"
              title="Delete profile"
              aria-label={`Delete ${ACCOUNT_TYPE_LABELS[profile.accountType]} profile`}
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        {profileVisible &&
          (editing ? (
            <ProfileEditor
              market={market}
              profile={profile}
              busy={busy}
              onCancel={() => setEditing(false)}
              onSave={async (updated, defs) => {
                // Removing a definition has to clear that value everywhere, not
                // just on the profile being edited — the server rejects a value
                // with no definition behind it.
                const dropped = market.customDimensionDefs
                  .filter((d) => !defs.some((n) => n.key === d.key))
                  .map((d) => d.key)
                const profiles = market.profiles.map((p) => {
                  const next = p.id === profile.id ? updated : p
                  if (dropped.length === 0) return next
                  return {
                    ...next,
                    customDimensions: Object.fromEntries(
                      Object.entries(next.customDimensions).filter(
                        ([k]) => !dropped.includes(k),
                      ),
                    ),
                  }
                })
                await run(() =>
                  api.updateMarket(market.market.code, {
                    ...market,
                    customDimensionDefs: defs,
                    profiles,
                  }),
                )
                setEditing(false)
              }}
            />
          ) : (
            <div className="acct-profile">
              <div className="profile-block">
                <h4 className="profile-block-title">APIs</h4>
                <div className="profile-apis">
                  {byCategory.map(({ cat, apis }) => (
                    <div key={cat} className="profile-group">
                      <span className="profile-group-label">{CATEGORY_LABELS[cat]}</span>
                      {/* Chips, not pills: this is a read-only inventory of
                          what the profile calls, so the verb adds noise
                          without helping anyone scan it. */}
                      <div className="review-chips">
                        {apis.map((a) => (
                          <span
                            key={a.name}
                            className={`chip chip-grad cat-${cat.toLowerCase()}`}
                            title={`${a.name} — ${a.summary}`}
                          >
                            {a.title}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Core behaviors come from the catalog and every market has all
                  four; custom ones are defined per market, so they are named
                  apart rather than mixed into the same run of chips. */}
              <div className="profile-block">
                <h4 className="profile-block-title">Behavior</h4>

                <div className="profile-behaviors">
                <div className="profile-group">
                  <span className="profile-group-label">Core</span>
                  <div className="review-chips">
                    {behaviors.map((b) => (
                      <span
                        key={b.key}
                        className={`chip chip-bhv ${profile.dimensions[b.key] !== 'N' ? 'on' : ''}`}
                        title={b.description}
                      >
                        {b.label}: {BEHAVIOR_VALUE_LABELS[profile.dimensions[b.key]]}
                      </span>
                    ))}
                  </div>
                </div>

                {Object.entries(profile.operations?.bothRules ?? {}).some(([, j]) => j && j.length > 0) && (
                  <div className="profile-group">
                    <span className="profile-group-label">BOTH rules</span>
                    <div className="review-chips">
                      {Object.entries(profile.operations.bothRules ?? {}).map(([key, journeys]) =>
                        profile.dimensions[key as keyof Behavior] === 'BOTH' && journeys?.length ? (
                          <span key={key} className="chip chip-bhv" title={journeys.join(', ')}>
                            {behaviors.find((b) => b.key === key)?.label}: Y for {journeys.length}
                          </span>
                        ) : null,
                      )}
                    </div>
                  </div>
                )}

                {market.customDimensionDefs.length > 0 && (
                  <div className="profile-group">
                    <span className="profile-group-label">Custom</span>
                    <div className="review-chips">
                      {market.customDimensionDefs.map((def) => {
                        const value = profile.customDimensions[def.key]
                        return (
                          <span
                            key={def.key}
                            className={`chip chip-custom ${value ? 'on' : ''}`}
                            title={def.description ?? def.key}
                          >
                            {def.label}:{' '}
                            {value ? (def.type === 'BOOLEAN' ? yn(value) : value) : 'Not set'}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
                </div>
              </div>

              <div className="profile-block">
                <h4 className="profile-block-title">Operations</h4>
                <dl className="ops-summary">
                  {operationsSummary(profile.operations ?? {}, profile.accountType).map(([k, v]) => (
                    <div key={k} className="ops-summary-row">
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          ))}
      </div>
    </section>
  )
}

/**
 * The draft against what has been released: a new version when the draft has changed or the last one can't run again,
 * the newest version when it hasn't been to e1 yet, and nothing while e1 already has it under way or live. Releasing
 * goes through the review, which shows the diff and names the approver.
 */
function DraftBar({
  market,
  profile,
  readiness,
  busy,
  missing,
  onRelease,
}: {
  market: MarketDocument
  profile: MarketProfile
  readiness: ProfileReadiness
  busy: boolean
  missing: number
  onRelease: () => Promise<void>
}) {
  const [reviewing, setReviewing] = useState(false)
  const latest = readiness.latestVersion ?? null
  const e1 = readiness.environments.find((e) => e.env === 'E1')
  const inE1 = latest != null ? e1?.history.find((d) => d.version === latest) : undefined
  const underWay = !!e1?.current && ['REQUESTED', 'RUNNING', 'WAITING_FOR_SIGN_OFF'].includes(e1.current.status)
  // A version that failed, was rolled back or was superseded never runs again, so the same content goes out as the
  // next version.
  const spent = !!inE1 && ['FAILED', 'ROLLED_BACK', 'SUPERSEDED'].includes(inE1.status)
  let version: number | null
  if (latest == null) version = 1
  else if (readiness.draftChanged || spent) version = latest + 1
  else if (!inE1) version = latest
  else version = null

  const title =
    latest == null
      ? 'Not released yet'
      : readiness.draftChanged
        ? `Draft changed since v${latest}`
        : version === null
          ? `No changes since v${latest}`
          : `v${latest} is ready to go again`
  const sub =
    latest == null
      ? `Releasing freezes the profile as v1 and sends it to e1${profile.editedBy ? `; last edited by ${profile.editedBy}` : ''}.`
      : readiness.draftChanged
        ? `Edited by ${profile.editedBy ?? 'someone'} after v${latest} was frozen. Review the changes, then a second person releases them.`
        : underWay
          ? `v${e1!.current!.version} is under way in e1; finish it before releasing another.`
          : version === null
            ? `v${latest} is live in e1. Edit the profile to release another version.`
            : `v${latest} can't run again in e1, so its content goes out as v${version}.`

  return (
    <div className={`draft-bar card ${version !== null && !underWay ? 'ready' : ''}`}>
      <span className="draft-ic" aria-hidden="true">
        Δ
      </span>
      <div>
        <div className="draft-t">{title}</div>
        <div className="draft-s">
          {sub}
          {missing > 0 && <span className="note-red"> e1's build lacks {missing} combination{missing > 1 ? 's' : ''} this draft needs.</span>}
        </div>
      </div>
      {version !== null && (
        <button className="btn primary" disabled={busy || underWay} onClick={() => setReviewing(true)}>
          Review and release v{version}
        </button>
      )}
      {reviewing && version !== null && (
        <ReleaseReview
          market={market}
          profile={profile}
          readiness={readiness}
          version={version}
          onClose={() => setReviewing(false)}
          onRelease={onRelease}
        />
      )}
    </div>
  )
}

/**
 * What happened to this profile, newest first, across every environment: releases, sign-offs, activations, refusals,
 * rollbacks, pauses and resumes, each with who and why. Read again whenever a release moves.
 */
function Activity({ market, profile }: { market: MarketDocument; profile: MarketProfile }) {
  const [rows, setRows] = useState<MarketRevision[] | null>(null)
  const label = ACCOUNT_TYPE_LABELS[profile.accountType]
  // Changes whenever any of this profile's deployments moves, which is when the history has something new.
  const signature = JSON.stringify(
    market.readiness?.find((r) => r.profileId === profile.id)?.environments.map((e) => [e.current?.status, e.current?.version, e.control?.at]) ?? [],
  )
  useEffect(() => {
    api
      .revisions(market.market.code)
      .then(setRows)
      .catch(() => setRows([]))
  }, [market.market.code, market.updatedAt, signature])
  const mine = (rows ?? []).filter((r) => !r.profileLabel || r.profileLabel === label).slice(0, 9)
  return (
    <aside className="activity card" aria-label={`${label} activity`}>
      <h4>Activity</h4>
      <p className="activity-sub">{label} · every environment · newest first</p>
      {rows === null && <p className="muted">Loading…</p>}
      {mine.map((r) => (
        <div key={r.id} className={`act act-${r.action.toLowerCase().replace(/_/g, '-')}`}>
          <i className="act-i" aria-hidden="true">
            {ACTION_MARKS[r.action] ?? '·'}
          </i>
          <div>
            <div className="act-w">
              {r.summary.replace(`${label} `, '').replace(`${label} — `, '')}
              {r.envs.map((e) => (
                <span key={e} className="act-env">
                  {e.toLowerCase()}
                </span>
              ))}
            </div>
            <div className="act-when">
              {r.actor} · {formatRelative(r.at)}
            </div>
          </div>
        </div>
      ))}
    </aside>
  )
}

const ACTION_MARKS: Partial<Record<MarketRevision['action'], string>> = {
  CREATED: '+',
  UPDATED: 'Δ',
  RELEASED: '▸',
  PROMOTED: '»',
  VERIFIED: '✓',
  RFC_RECORDED: '#',
  ACTIVATED: '●',
  FAILED: '!',
  REFUSED: '×',
  ROLLED_BACK: '↶',
  PAUSED: 'II',
  RESUMED: '▶',
  CLONED: '⧉',
  PROFILE_DELETED: '−',
}

/* ---------- Inline profile editor: APIs, behavior, custom values ---------- */

function ProfileEditor({
  market,
  profile,
  busy,
  onCancel,
  onSave,
}: {
  market: MarketDocument
  profile: MarketProfile
  busy: boolean
  onCancel: () => void
  onSave: (updated: MarketProfile, defs: CustomBehaviorDef[]) => void
}) {
  const { catalog, role } = useApp()
  const [apis, setApis] = useState<string[]>(profile.apis)
  const [behavior, setBehaviorState] = useState<Behavior>({ ...profile.dimensions })
  const [operations, setOperations] = useState<OperationsSettings>({ ...profile.operations })
  const [customValues, setCustomValues] = useState<Record<string, string>>({
    ...profile.customDimensions,
  })
  // Definitions are market-scoped but edited here, so they travel with the
  // save rather than needing a second trip.
  const [defs, setDefs] = useState<CustomBehaviorDef[]>(market.customDimensionDefs)

  function toggleApi(name: string) {
    setApis((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  function removeDef(key: string) {
    setDefs(defs.filter((d) => d.key !== key))
    setCustomValues(Object.fromEntries(Object.entries(customValues).filter(([k]) => k !== key)))
  }

  const canSave = apis.length > 0

  return (
    <div className="profile-editor">
      <div className="pe-section">
        <h5>APIs</h5>
        <div className="pe-api-groups">
          {CATEGORY_ORDER.map((cat) => (
            <div key={cat} className="pe-api-group">
              <span className={`pe-cat cat-${cat.toLowerCase()}`}>{CATEGORY_LABELS[cat]}</span>
              {(catalog?.apis ?? [])
                .filter((a) => a.category === cat)
                .map((a) => (
                  <label key={a.name} className="pe-api" title={a.summary}>
                    <input
                      type="checkbox"
                      checked={apis.includes(a.name)}
                      onChange={() => toggleApi(a.name)}
                    />
                    <ApiIdentity spec={a} />
                  </label>
                ))}
            </div>
          ))}
        </div>
      </div>

      <div className="pe-section">
        <h5>Behavior</h5>

        <div className="pe-bhv-group">
          <span className="pe-cat">Core</span>
          {/* Two-up grid rather than the wizard's stack: these are settings
              being adjusted, not explained. */}
          <div className="pe-behavior">
            {(catalog?.behaviors ?? []).map((b) => (
              <BehaviorRow
                key={b.key}
                meta={b}
                behavior={behavior}
                accountTypes={[profile.accountType]}
                journeys={operations.bothRules?.[b.key] ?? []}
                compact
                onChange={setBehaviorState}
                onJourneys={(journeys) => setOperations({ ...operations, bothRules: { ...operations.bothRules, [b.key]: journeys } })}
              />
            ))}
          </div>
        </div>

        {role === 'ADMIN' && (
          <div className="pe-bhv-group">
            <span className="pe-cat">Custom</span>
            {defs.map((def) => (
              <CustomBehaviorRow
                key={def.key}
                def={def}
                value={customValues[def.key] ?? ''}
                compact
                onValue={(v) => setCustomValues({ ...customValues, [def.key]: v })}
                onDescription={(description) =>
                  setDefs(defs.map((d) => (d.key === def.key ? { ...d, description } : d)))
                }
                onRemove={() => removeDef(def.key)}
              />
            ))}

            <CustomBehaviorDefForm
              existingKeys={defs.map((d) => d.key)}
              onAdd={(def) => setDefs([...defs, def])}
            />

            <p className="bhv-scope-note">
              Values are set per account profile; adding or removing a behavior changes it for
              every profile in {market.market.name}. Nothing is written until you save.
            </p>
          </div>
        )}
      </div>

      <div className="pe-section">
        <h5>Operations</h5>
        <OperationsEditor
          value={operations}
          onChange={setOperations}
          accountTypes={[profile.accountType]}
          behavior={behavior}
          currency={market.market.currency}
        />
      </div>

      {!canSave && <p className="hint-warn">Select at least one API.</p>}

      <div className="pe-actions">
        <button className="btn sm ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn sm primary"
          disabled={busy || !canSave}
          onClick={() =>
            onSave(
              {
                ...profile,
                apis,
                dimensions: behavior,
                operations,
                customDimensions: Object.fromEntries(
                  Object.entries(customValues).filter(
                    // A value whose definition was just removed must not
                    // survive the save — the server rejects orphans.
                    ([k, v]) => v !== '' && defs.some((d) => d.key === k),
                  ),
                ),
              },
              defs,
            )
          }
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
