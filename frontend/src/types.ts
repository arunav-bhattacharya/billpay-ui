/** Stored as BUSINESS_TRAVEL_ACCOUNT; a release sends BUSINESS_TRAVEL (billpay-core maps it). */
export type AccountType = 'CONSUMER' | 'CORPORATE' | 'BUSINESS_TRAVEL_ACCOUNT'
/** Deployment environment. Strictly linear: a release is promoted one stage at a time; e3 is production. */
export type EnvStage = 'E1' | 'E2' | 'E3'
export type ApiCategory = 'CORE' | 'COMPOSITE' | 'EVENT_HANDLER'
/** Maker and checker: an Operator authors a profile, and an Approver releases what someone else authored. */
export type Role = 'OPERATOR' | 'APPROVER'

/** The persisted behavior keys, which are also the release JSON's (billpay-core's Router reads them). */
export type BehaviorKey =
  | 'requiresArPosting'
  | 'requiresRealtimeClearing'
  | 'requiresMandateAuthorization'
  | 'requiresBankConfirmation'

/** 'BOTH' = required for some journeys but not others; the Router resolves it per payment. */
export type BehaviorValue = 'Y' | 'N' | 'BOTH'

export type Behavior = Record<BehaviorKey, BehaviorValue>

// ---- Operations settings: each field is the release key of the same name ----

export interface RepresentmentRules {
  representableReasons: string[]
  maxRepresentments: number
  delayDays: number
}

export interface BankConfirmationSettings {
  confirmationWindow?: string | null
  statusCheckDelay?: string | null
  statusCheckInterval?: string | null
  statusCheckMaxInterval?: string | null
}

export interface CardAuthenticationSettings {
  provider?: string | null
  authenticationWindow?: string | null
}

export interface RuleSettings {
  maxPaymentAmount?: string | null
  acceptedInstrumentTypes?: string[] | null
}

/**
 * The Operations step. Durations are ISO-8601 (`PT1H`), `executionTime` is `HH:mm`; an absent key means unset, and
 * billpay-core's default applies. `bothRules` holds, per behavior set to BOTH, the journeys that get Y.
 */
export interface OperationsSettings {
  timeZone?: string | null
  executionTime?: string | null
  cancellationWindow?: string | null
  executionCutoff?: string | null
  executionFloorTps?: number | null
  allocationFetchBefore?: string | null
  allocationAlertAfter?: string | null
  representment?: RepresentmentRules | null
  ravenStatuses?: string[] | null
  bankConfirmation?: BankConfirmationSettings | null
  cardAuthentication?: CardAuthenticationSettings | null
  payWithMrPoints?: boolean
  enrolledInstrumentStatuses?: Record<string, string[]>
  pendingSweepAfter?: string | null
  testAccounts?: string[]
  ruleSettings?: RuleSettings | null
  bothRules?: Partial<Record<BehaviorKey, string[]>>
}

export interface MarketProfile {
  id?: string
  accountType: AccountType
  /** The furthest environment a release of this profile has been sent to. */
  status: EnvStage
  apis: string[]
  /** Wire key predates the behavior rename. */
  dimensions: Behavior
  operations: OperationsSettings
  /** Who last changed the draft: the author when it is next frozen. */
  editedBy?: string | null
}

/** Country-specific attributes, grouped under `market` in the document. */
export interface MarketInfo {
  code: string
  name: string
  currency: string
  region: string
}

// ---- releases, deployments and readiness (derived server-side, read-only) ----

/** Where a release stands in one environment, as billpay-core's Market Onboarding API reports it. */
export type ReleaseStatus =
  | 'REQUESTED'
  | 'RUNNING'
  | 'WAITING_FOR_SIGN_OFF'
  | 'ACTIVE'
  | 'FAILED'
  | 'ROLLED_BACK'
  | 'SUPERSEDED'

export type ReleaseStep = 'CHECK' | 'SAVE' | 'TEST' | 'WAIT' | 'ACTIVATE' | 'ROLLBACK'

/** CONNECTED calls the environment's API; SIMULATED is a marked placeholder billpay-ui walks itself. */
export type EnvMode = 'CONNECTED' | 'SIMULATED'

export interface EnvironmentInfo {
  env: EnvStage
  name: string
  mode: EnvMode
  url?: string | null
  rfcRequired: boolean
}

export interface DeploymentView {
  version: number
  env: EnvStage
  workflowId?: string | null
  status: ReleaseStatus
  step?: ReleaseStep | null
  reason?: string | null
  needsBuild: boolean
  replacedVersion?: number | null
  simulated: boolean
  requestedBy?: string | null
  requestedAt: string
  updatedAt: string
  signedOffBy?: string | null
  signedOffAt?: string | null
  rfc?: string | null
  /** The last call to the environment that failed, such as a 503 while its Offline cluster is down. */
  lastError?: string | null
}

/** A market and account type live in one environment, with the release JSON of the version it runs. */
export interface LiveRelease {
  market: string
  marketName: string
  region: string
  accountType: AccountType
  version: number
  simulated: boolean
  paused: boolean
  since: string
  config: ReleaseConfig
}

/** The release JSON keys the console reads back (billpay-core `ReleaseConfig`). */
export interface ReleaseConfig {
  apis?: string[]
  behaviors?: Partial<Record<BehaviorKey, { value: BehaviorValue; yesForJourneys?: string[] }>>
  timeZone?: string
  executionTime?: string
  cancellationWindow?: string
  executionCutoff?: string
  [key: string]: unknown
}

export interface ControlView {
  env: EnvStage
  paused: boolean
  by: string
  reason?: string | null
  at: string
}

export type EnvOnboardingState = 'NOT_CONFIGURED' | 'ONBOARDING_IN_PROGRESS' | 'ONBOARDED' | 'FAILED'
export type StepState = 'COMPLETE' | 'IN_PROGRESS' | 'PENDING' | 'FAILED'

export interface ReadinessStep {
  key: string
  name: string
  description: string
  state: StepState
}

export interface EnvReadiness {
  env: EnvStage
  mode: EnvMode
  state: EnvOnboardingState
  /** The newest version sent here. */
  current?: DeploymentView | null
  /** The version active here now. */
  live?: DeploymentView | null
  steps: ReadinessStep[]
  history: DeploymentView[]
  control?: ControlView | null
}

export interface ProfileReadiness {
  profileId: string
  accountType: AccountType
  latestVersion?: number | null
  /** The draft differs from the newest frozen version. */
  draftChanged: boolean
  /** The furthest environment a version of this profile is live in; null when none is. */
  liveIn?: EnvStage | null
  environments: EnvReadiness[]
}

export interface ReleaseView {
  version: number
  accountType: AccountType
  checksum: string
  author?: string | null
  approver?: string | null
  createdAt: string
  config: ReleaseConfig
}

export interface Capability {
  accountType: string
  requiresArPosting: 'Y' | 'N'
  requiresRealtimeClearing: 'Y' | 'N'
  requiresMandateAuthorization: 'Y' | 'N'
  requiresBankConfirmation: 'Y' | 'N'
}

export interface Capabilities {
  buildVersion: string
  combinations: Capability[]
}

// ---- revision history ----

export type RevisionAction =
  | 'CREATED'
  | 'UPDATED'
  | 'RELEASED'
  | 'PROMOTED'
  | 'VERIFIED'
  | 'RFC_RECORDED'
  | 'ACTIVATED'
  | 'FAILED'
  | 'REFUSED'
  | 'ROLLED_BACK'
  | 'PAUSED'
  | 'RESUMED'
  | 'PROFILE_DELETED'
  | 'CLONED'

export interface MarketRevision {
  id: number
  action: RevisionAction
  actor: string
  summary: string
  /** The environments this change landed in. */
  envs: EnvStage[]
  profileLabel?: string | null
  beforeJson?: string | null
  afterJson?: string | null
  at: string
}

export interface MarketDocument {
  market: MarketInfo
  /** The furthest environment a release was sent to. */
  status: EnvStage
  /** The furthest environment a version is live in, which is what "live" means in the UI; null when none is. */
  liveIn?: EnvStage | null
  profiles: MarketProfile[]
  /** Derived from the deployment rows; absent on documents we send back up. */
  readiness?: ProfileReadiness[]
  createdAt?: string
  updatedAt?: string
}

export interface ApiSpec {
  name: string
  /** Plain-language headline; `name` is the versioned identifier a release lists. */
  title: string
  category: ApiCategory
  /** An HTTP verb, INBOX for work One-Data keeps for a dispatcher, or EVENT for an event handler. */
  method: string
  path: string
  summary: string
  description: string
  /** Deep link into the API Explorer page for this function. */
  specUrl: string
}

export interface CuratedMarket {
  code: string
  name: string
  currency: string
  region: string
  /** Account types this market supports (defaults to all three server-side). */
  allowedAccountTypes: AccountType[]
}

export interface BehaviorMeta {
  key: BehaviorKey
  label: string
  description: string
  /** BOTH takes a list of journeys from the Operations step; the other BOTH rules are the spec's own. */
  bothRuleByJourney: boolean
  /** Account types the behavior applies to; any other is held at N. */
  accountTypes: AccountType[]
}

export interface AccountTypeMeta {
  key: AccountType
  label: string
  description: string
}

export interface JourneyMeta {
  key: string
  label: string
}

export interface Catalog {
  apis: ApiSpec[]
  markets: CuratedMarket[]
  behaviors: BehaviorMeta[]
  accountTypes: AccountTypeMeta[]
  journeys: JourneyMeta[]
  paymentStatuses: string[]
  defaultRavenStatuses: string[]
  journeyContexts: string[]
}

export const BEHAVIOR_KEYS: BehaviorKey[] = [
  'requiresArPosting',
  'requiresRealtimeClearing',
  'requiresMandateAuthorization',
  'requiresBankConfirmation',
]

export const EMPTY_BEHAVIOR: Behavior = {
  requiresArPosting: 'N',
  requiresRealtimeClearing: 'N',
  requiresMandateAuthorization: 'N',
  requiresBankConfirmation: 'N',
}

/**
 * What a new profile starts with in the wizard. Reporting to Accounts Receivable is the norm, so it is on unless the
 * operator turns it off: a visible default they can change, not a silent one.
 */
export const DEFAULT_BEHAVIOR: Behavior = {
  ...EMPTY_BEHAVIOR,
  requiresArPosting: 'Y',
}

/** A new profile's Operations settings: the spec's defaults, written out so the operator sees them. */
export const DEFAULT_OPERATIONS: OperationsSettings = {
  executionTime: '00:00',
  cancellationWindow: 'PT1H',
  payWithMrPoints: false,
  testAccounts: [],
}
