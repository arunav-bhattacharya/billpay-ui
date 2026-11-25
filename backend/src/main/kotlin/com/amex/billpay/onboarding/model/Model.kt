package com.amex.billpay.onboarding.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonInclude
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

/**
 * Declaration order is presentation order: Consumer, Corporate, Business Travel. Profiles are sorted by it on read, so
 * a market always lists its account types the same way, whatever order they were added in.
 *
 * The third type is stored as BUSINESS_TRAVEL_ACCOUNT; billpay-core's Market Onboarding API maps it to BUSINESS_TRAVEL
 * (wiki, "What changes in today's Market Onboarding UI code"; Proposed, 2026-10-18). [apiName] is what a release sends.
 */
enum class AccountType(val apiName: String) {
    CONSUMER("CONSUMER"),
    CORPORATE("CORPORATE"),
    BUSINESS_TRAVEL_ACCOUNT("BUSINESS_TRAVEL");

    companion object {
        /** Accepts the pre-rename SMALL_BUSINESS still present in stored documents. */
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun from(raw: String): AccountType = when (raw.uppercase()) {
            "SMALL_BUSINESS", "BUSINESS_TRAVEL_ACCOUNT", "BUSINESS_TRAVEL" -> BUSINESS_TRAVEL_ACCOUNT
            "CONSUMER" -> CONSUMER
            "CORPORATE" -> CORPORATE
            else -> throw IllegalArgumentException("Unknown account type '$raw'")
        }
    }
}

/**
 * The environments a release moves through: E1, E2, then E3, which is production and needs an RFC (wiki, "Market
 * Onboarding"). Declaration order is promotion order; [next] and `maxOf` rely on it.
 */
enum class EnvStage {
    E1,
    E2,
    E3;

    fun next(): EnvStage? = entries.getOrNull(ordinal + 1)

    companion object {
        /** Accepts the pre-rename DRAFT/ACTIVE still present in stored documents. */
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun from(raw: String): EnvStage = when (raw.uppercase()) {
            "DRAFT", "E1" -> E1
            "E2" -> E2
            "ACTIVE", "E3" -> E3
            else -> throw IllegalArgumentException("Unknown environment '$raw'")
        }
    }
}

/** A behavior's setting. [BOTH] means required for some journeys and not others; the Router resolves it per payment. */
enum class BehaviorValue {
    Y,
    N,
    BOTH;

    companion object {
        /** Delegating with [Any]: stored documents predating the tri-state carry plain JSON booleans. */
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun from(raw: Any?): BehaviorValue = when (raw) {
            null -> N
            is Boolean -> if (raw) Y else N
            is String -> when (raw.uppercase()) {
                "Y", "TRUE" -> Y
                "N", "FALSE", "" -> N
                "BOTH", "B" -> BOTH
                else -> throw IllegalArgumentException("Unknown behavior value '$raw'")
            }
            else -> throw IllegalArgumentException("Unsupported behavior value: $raw")
        }
    }
}

/**
 * The four market behaviors besides the account type, under the JSON keys billpay-core's Router reads (wiki, "Market
 * Onboarding & Payment Dimensions"). Stored documents may still carry `requiresRepresentableReturn`, which went when
 * representment became a market rule (the Operations step's `representment` block); it is ignored on read.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class Behavior(
    val requiresArPosting: BehaviorValue = BehaviorValue.N,
    val requiresRealtimeClearing: BehaviorValue = BehaviorValue.N,
    val requiresMandateAuthorization: BehaviorValue = BehaviorValue.N,
    /** Consumer only for now: corporate never takes it, and business travel waits until it is turned on (spec). */
    val requiresBankConfirmation: BehaviorValue = BehaviorValue.N,
)

// ---- Operations settings (wiki, "Operations settings"; each becomes a release JSON key) ----

/** Which returns are represented, how often, and after how many days; a release without it represents nothing. */
data class RepresentmentRules(
    val representableReasons: List<String> = emptyList(),
    val maxRepresentments: Int = 1,
    val delayDays: Int = 0,
)

/** Bank confirmation's waits, ISO durations: the market's 24 to 48 hours, and the fallback status calls. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class BankConfirmationSettings(
    val confirmationWindow: String? = null,
    val statusCheckDelay: String? = null,
    val statusCheckInterval: String? = null,
    val statusCheckMaxInterval: String? = null,
)

/** The card provider for a debit card's 3D Secure, and its authentication window (2 minutes, agreed 2026-10-20). */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class CardAuthenticationSettings(
    val provider: String? = null,
    val authenticationWindow: String? = null,
)

/** Verification rule settings the rules read: the largest payment, "25000 GBP", and the instrument types taken. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class RuleSettings(
    val maxPaymentAmount: String? = null,
    val acceptedInstrumentTypes: List<String>? = null,
)

/**
 * The Operations step: everything a release carries besides its APIs and behaviors. Each field is the release key of
 * the same name, as an ISO duration or `HH:mm` where the key is one; null means unset, and billpay-core's default
 * applies. [bothRules] holds, per behavior set to BOTH, the journeys that get Y (`yesForJourneys`); realtime clearing's
 * and bank confirmation's BOTH rules are the spec's own, so only AR posting and mandate authorization have one.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
data class OperationsSettings(
    val timeZone: String? = null,
    val executionTime: String? = null,
    val cancellationWindow: String? = null,
    val executionCutoff: String? = null,
    val executionFloorTps: BigDecimal? = null,
    val allocationFetchBefore: String? = null,
    val allocationAlertAfter: String? = null,
    val representment: RepresentmentRules? = null,
    val ravenStatuses: List<String>? = null,
    val bankConfirmation: BankConfirmationSettings? = null,
    val cardAuthentication: CardAuthenticationSettings? = null,
    val payWithMrPoints: Boolean = false,
    val enrolledInstrumentStatuses: Map<String, List<String>> = emptyMap(),
    val pendingSweepAfter: String? = null,
    val testAccounts: List<String> = emptyList(),
    val ruleSettings: RuleSettings? = null,
    val bothRules: Map<String, List<String>> = emptyMap(),
)

/**
 * One market and account type: its API selection, behaviors and Operations settings. This is the draft; a release
 * freezes it as vN, and later edits become vN+1.
 *
 * `dimensions` stays as the JSON key: it is persisted in every stored document, and only the concept's name changed.
 * Stored documents may still carry `customDimensions`, from market-specific custom behaviors, which no release key
 * ever carried to billpay-core; they are ignored on read. [status] is the furthest environment a release of this
 * profile has been sent to; a profile starts in E1, where its first release goes.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class MarketProfile(
    val id: String = UUID.randomUUID().toString(),
    val accountType: AccountType,
    val status: EnvStage = EnvStage.E1,
    val apis: List<String> = emptyList(),
    val dimensions: Behavior = Behavior(),
    val operations: OperationsSettings = OperationsSettings(),
    /** Who last changed the draft: the author when it is next frozen (maker-checker). */
    val editedBy: String? = null,
)

/** The part of a market that is persisted as a JSON document. Older documents' `customDimensionDefs` are ignored. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class MarketConfig(
    val profiles: List<MarketProfile> = emptyList(),
)

/** Country-specific attributes, grouped under `market` in the document. */
data class MarketInfo(
    val code: String,
    val name: String = "",
    val currency: String = "",
    val region: String = "",
)

// ---- releases and deployments (wiki, "From draft to live") ----

/** Where a release stands in one environment, as billpay-core's Market Onboarding API reports it. */
enum class ReleaseStatus {
    REQUESTED,
    RUNNING,
    WAITING_FOR_SIGN_OFF,
    ACTIVE,
    FAILED,
    ROLLED_BACK,
    SUPERSEDED;

    /** Still moving on its own: the tracker polls these. */
    val inFlight: Boolean get() = this == REQUESTED || this == RUNNING || this == WAITING_FOR_SIGN_OFF
}

/** MarketOnboardingWorkflow's steps; ROLLBACK is Proposed in billpay-core. */
enum class ReleaseStep { CHECK, SAVE, TEST, WAIT, ACTIVATE, ROLLBACK }

/**
 * How billpay-ui reaches an environment. CONNECTED calls its Market Onboarding API. SIMULATED is a marked
 * placeholder for an environment with no API configured (locally E2 and E3): billpay-ui walks the release through
 * the same steps itself, so the pipeline can be shown end to end, and labels every row it makes that way.
 */
enum class EnvMode { CONNECTED, SIMULATED }

data class EnvironmentInfo(
    val env: EnvStage,
    val name: String,
    val mode: EnvMode,
    /** The Market Onboarding API's base URL; null when simulated. */
    val url: String?,
    val rfcRequired: Boolean,
)

/** One frozen release: a profile's full config as billpay-core reads it, its checksum, author and approver. */
data class ReleaseView(
    val version: Int,
    val accountType: AccountType,
    val checksum: String,
    val author: String?,
    val approver: String?,
    val createdAt: Instant,
    /** The release JSON sent as `config`. */
    val config: Any?,
)

/** A release in one environment: the deployment row that follows its workflow there. */
data class DeploymentView(
    val version: Int,
    val env: EnvStage,
    val workflowId: String?,
    val status: ReleaseStatus,
    val step: ReleaseStep?,
    val reason: String?,
    val needsBuild: Boolean,
    val replacedVersion: Int?,
    val simulated: Boolean,
    val requestedBy: String?,
    val requestedAt: Instant,
    val updatedAt: Instant,
    val signedOffBy: String?,
    val signedOffAt: Instant?,
    val rfc: String?,
    /** The last call to the environment that failed, such as a 503 while its Offline cluster is down. */
    val lastError: String?,
)

/** A market and account type live in one environment, with the release JSON of the version it runs. */
data class LiveRelease(
    val market: String,
    val marketName: String,
    val region: String,
    val accountType: AccountType,
    val version: Int,
    val simulated: Boolean,
    val paused: Boolean,
    val since: Instant,
    val config: Any?,
)

/** A live market and account type paused or resumed in one environment, the newest change. */
data class ControlView(
    val env: EnvStage,
    val paused: Boolean,
    val by: String,
    val reason: String?,
    val at: Instant,
)

// ---- environment readiness (derived on read from the deployment rows, never persisted) ----

enum class EnvOnboardingState { NOT_CONFIGURED, ONBOARDING_IN_PROGRESS, ONBOARDED, FAILED }

enum class StepState { COMPLETE, IN_PROGRESS, PENDING, FAILED }

/** One step of the current release's workflow in an environment. */
data class ReadinessStep(
    val key: String,
    val name: String,
    val description: String,
    val state: StepState,
)

/**
 * A profile's standing in one environment. [current] is the newest version sent there and [steps] are its; [live] is
 * the version active there now, which is [current] once it activates and the one before it until then.
 */
data class EnvReadiness(
    val env: EnvStage,
    val mode: EnvMode,
    val state: EnvOnboardingState,
    val current: DeploymentView? = null,
    val live: DeploymentView? = null,
    val steps: List<ReadinessStep> = emptyList(),
    val history: List<DeploymentView> = emptyList(),
    val control: ControlView? = null,
)

data class ProfileReadiness(
    val profileId: String,
    val accountType: AccountType,
    /** The newest frozen version, or null before the first release. */
    val latestVersion: Int? = null,
    /** The draft differs from [latestVersion], so the next release freezes a new version. */
    val draftChanged: Boolean = true,
    /** The furthest environment a version of this profile is live in, or null when none is. */
    val liveIn: EnvStage? = null,
    val environments: List<EnvReadiness> = emptyList(),
)

/**
 * Full market document exchanged with the UI. [status] is the furthest environment any profile's release was sent to;
 * [liveIn] the furthest one a version is live in, which is what "live" means everywhere in the UI.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class MarketDocument(
    val market: MarketInfo,
    val status: EnvStage = EnvStage.E1,
    val liveIn: EnvStage? = null,
    val profiles: List<MarketProfile> = emptyList(),
    /**
     * Derived on read; never written back. Nullable because it is output-only: clients POST and PUT documents without
     * it, and the deserializer does not fill in Kotlin defaults for absent non-null fields.
     */
    val readiness: List<ProfileReadiness>? = null,
    val createdAt: Instant? = null,
    val updatedAt: Instant? = null,
)

/** What ServiceNow says about a change request number. */
data class RfcValidation(
    val rfcNumber: String,
    val valid: Boolean,
    val message: String,
)

/**
 * Body of the change-request validation call.
 *
 * No default on the property, deliberately: give every parameter one and Kotlin synthesizes a no-arg constructor,
 * which Jackson then prefers over the parameter-name creator, leaving every `val` at its default.
 */
data class RfcRequest(val rfcNumber: String)

/** Body of a rollback, pause or resume: why, for the audit and for billpay-core's `reason`. */
data class ControlRequest(val reason: String? = null)

data class CloneRequest(
    val targetCode: String,
    /** Account types to carry over; null or empty means all. */
    val accountTypes: List<AccountType>? = null,
)

// ---- revision history ----

enum class RevisionAction {
    CREATED,
    UPDATED,
    RELEASED,
    PROMOTED,
    VERIFIED,
    RFC_RECORDED,
    ACTIVATED,
    FAILED,
    REFUSED,
    ROLLED_BACK,
    PAUSED,
    RESUMED,
    PROFILE_DELETED,
    CLONED,
}

/** One recorded change to a market, newest first when listed. */
data class MarketRevision(
    val id: Long,
    val action: RevisionAction,
    val actor: String,
    val summary: String,
    /** The environments the change landed in: each environment keeps a history of its own. */
    val envs: List<EnvStage> = emptyList(),
    val profileLabel: String? = null,
    val beforeJson: String? = null,
    val afterJson: String? = null,
    val at: Instant,
)
