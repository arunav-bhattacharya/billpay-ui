export type AccountType = 'CONSUMER' | 'CORPORATE' | 'BUSINESS_TRAVEL_ACCOUNT'
/** Deployment environment. Strictly linear — promoted one stage at a time. */
export type EnvStage = 'E1' | 'E2' | 'E3'
export type CustomBehaviorType = 'BOOLEAN' | 'ENUM' | 'TEXT'
export type ApiCategory = 'CORE' | 'COMPOSITE' | 'EVENT_HANDLER'
export type Role = 'OPERATOR' | 'ADMIN'

/**
 * The persisted behavior keys. They kept the `requires*` names they were given
 * when the concept was called a dimension — every stored document uses them.
 */
export type BehaviorKey =
  | 'requiresArPosting'
  | 'requiresRealtimeClearing'
  | 'requiresMandateAuthorization'
  | 'requiresRepresentableReturn'

/** 'BOTH' = required for some flows but not others. */
export type BehaviorValue = 'Y' | 'N' | 'BOTH'

export interface Behavior {
  requiresArPosting: BehaviorValue
  requiresRealtimeClearing: BehaviorValue
  requiresMandateAuthorization: BehaviorValue
  /** Only meaningful when realtime clearing is not 'Y'; never 'BOTH'. */
  requiresRepresentableReturn: BehaviorValue
}

export interface CustomBehaviorDef {
  key: string
  label: string
  type: CustomBehaviorType
  allowedValues: string[]
  description?: string | null
}

export interface MarketProfile {
  id?: string
  accountType: AccountType
  status: EnvStage
  apis: string[]
  /** Wire key predates the behavior rename. */
  dimensions: Behavior
  /** Wire key predates the behavior rename. */
  customDimensions: Record<string, string>
  /**
   * The environment this profile was last signed off in. Equal to `status`
   * means the current environment is verified and the profile can be promoted
   * out of it; anything else means it still has work to close.
   */
  verifiedIn?: EnvStage | null
  /** ServiceNow change request authorising the production release. */
  rfcNumber?: string | null
}

/** Country-specific attributes, grouped under `market` in the document. */
export interface MarketInfo {
  code: string
  name: string
  currency: string
  region: string
}

// ---- environment readiness (derived server-side, read-only) ----

export type EnvOnboardingState = 'NOT_CONFIGURED' | 'ONBOARDING_IN_PROGRESS' | 'ONBOARDED'
export type StepState = 'COMPLETE' | 'IN_PROGRESS' | 'PENDING'

export interface ApiVerification {
  name: string
  title: string
  verified: boolean
}

export interface ReadinessStep {
  key: string
  name: string
  description: string
  state: StepState
  /** Only the verify step carries these — one per API the profile onboards. */
  apis: ApiVerification[]
}

export interface EnvReadiness {
  env: EnvStage
  state: EnvOnboardingState
  completedAt?: string | null
  steps: ReadinessStep[]
}

export interface ProfileReadiness {
  profileId: string
  accountType: AccountType
  environments: EnvReadiness[]
}

// ---- revision history ----

export type RevisionAction =
  | 'CREATED'
  | 'UPDATED'
  | 'PROMOTED'
  | 'VERIFIED'
  | 'RFC_RECORDED'
  | 'PROFILE_DELETED'
  | 'CLONED'

export interface MarketRevision {
  id: number
  action: RevisionAction
  actor: string
  summary: string
  /** The environments this change landed in — a profile's stage is where its work happens. */
  envs: EnvStage[]
  profileLabel?: string | null
  beforeJson?: string | null
  afterJson?: string | null
  at: string
}

export interface MarketDocument {
  market: MarketInfo
  status: EnvStage
  /** Wire key predates the behavior rename. */
  customDimensionDefs: CustomBehaviorDef[]
  profiles: MarketProfile[]
  /** Derived from each profile's stage; absent on documents we send back up. */
  readiness?: ProfileReadiness[]
  createdAt?: string
  updatedAt?: string
}

/**
 * A market document narrowed to a single environment — what that environment
 * actually holds. `status` is dropped: it names how far the market has got
 * overall, which is not a fact about any one environment.
 */
export interface EnvMarketDocument extends Omit<MarketDocument, 'status'> {
  environment: EnvStage
}

export interface ApiSpec {
  name: string
  /** Plain-language headline; `name` is the versioned identifier. */
  title: string
  category: ApiCategory
  method: string
  path: string
  summary: string
  description: string
  /** Behaviors this API typically calls for — guidance only, never auto-selected. */
  suggests: BehaviorKey[]
  /** Deep link into the One-Data API spec book. */
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
  /** False for strictly Y/N behaviors — the control renders two segments. */
  allowsBoth: boolean
}

export interface AccountTypeMeta {
  key: AccountType
  label: string
  description: string
}

export interface Catalog {
  apis: ApiSpec[]
  markets: CuratedMarket[]
  /** Wire key predates the behavior rename — these are behavior definitions. */
  dimensions: BehaviorMeta[]
  accountTypes: AccountTypeMeta[]
  environmentNames: Record<EnvStage, string>
}

export const BEHAVIOR_KEYS: BehaviorKey[] = [
  'requiresArPosting',
  'requiresRealtimeClearing',
  'requiresMandateAuthorization',
  'requiresRepresentableReturn',
]

export const EMPTY_BEHAVIOR: Behavior = {
  requiresArPosting: 'N',
  requiresRealtimeClearing: 'N',
  requiresMandateAuthorization: 'N',
  requiresRepresentableReturn: 'N',
}

/**
 * What a new profile starts with in the wizard. Reporting to Accounts
 * Receivable is the norm, so it is on unless the operator turns it off — a
 * visible default they can change, not a silent one.
 *
 * Deliberately separate from the stored default: the server still reads an
 * absent flag as N, so this cannot rewrite what old documents mean.
 */
export const DEFAULT_BEHAVIOR: Behavior = {
  ...EMPTY_BEHAVIOR,
  requiresArPosting: 'Y',
}
