package com.amex.billpay.onboarding.model

import com.fasterxml.jackson.annotation.JsonCreator
import java.time.Instant
import java.util.UUID

/**
 * Declaration order is presentation order — Consumer, Corporate, Business
 * Travel — and profiles are sorted by it on read, so a market always lists its
 * account types the same way regardless of the order they were added.
 */
enum class AccountType {
    CONSUMER,
    CORPORATE,
    BUSINESS_TRAVEL_ACCOUNT;

    companion object {
        /** Accepts the pre-rename SMALL_BUSINESS still present in stored documents. */
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun from(raw: String): AccountType = when (raw.uppercase()) {
            "SMALL_BUSINESS", "BUSINESS_TRAVEL_ACCOUNT" -> BUSINESS_TRAVEL_ACCOUNT
            "CONSUMER" -> CONSUMER
            "CORPORATE" -> CORPORATE
            else -> throw IllegalArgumentException("Unknown account type '$raw'")
        }
    }
}

/**
 * Deployment environment a profile has reached. Strictly linear: a profile is
 * promoted one stage at a time, and only E3 counts as fully live.
 * Declaration order is promotion order — [next] and `maxOf` both rely on it.
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

enum class CustomBehaviorType { BOOLEAN, ENUM, TEXT }

/**
 * A behavior's setting. [BOTH] means the market requires the behavior for
 * some flows and not others, so it is not reducible to a single yes or no.
 */
enum class BehaviorValue {
    Y,
    N,
    BOTH;

    companion object {
        /**
         * Delegating with [Any] so Jackson hands over the raw node: stored
         * documents predating the tri-state carry plain JSON booleans.
         */
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
 * The standard processing behaviors minus accountType, which lives on the profile.
 *
 * The four field names are persisted JSON keys in every stored document — the
 * concept was renamed from "dimension" to "behavior", the keys were not.
 */
data class Behavior(
    val requiresArPosting: BehaviorValue = BehaviorValue.N,
    val requiresRealtimeClearing: BehaviorValue = BehaviorValue.N,
    val requiresMandateAuthorization: BehaviorValue = BehaviorValue.N,
    /** Only meaningful when realtime clearing is not [BehaviorValue.Y]; never [BehaviorValue.BOTH]. */
    val requiresRepresentableReturn: BehaviorValue = BehaviorValue.N,
)

/** Admin-defined, market-scoped custom behavior definition. */
data class CustomBehaviorDef(
    val key: String,
    val label: String,
    val type: CustomBehaviorType,
    val allowedValues: List<String> = emptyList(),
    val description: String? = null,
)

/**
 * One combination of accountType + behavior + API selection within a market.
 *
 * `dimensions` and `customDimensions` stay as JSON keys: they are persisted in
 * every stored document, and only the concept's name changed.
 */
data class MarketProfile(
    val id: String = UUID.randomUUID().toString(),
    val accountType: AccountType,
    val status: EnvStage = EnvStage.E1,
    val apis: List<String> = emptyList(),
    val dimensions: Behavior = Behavior(),
    val customDimensions: Map<String, String> = emptyMap(),
    /**
     * The environment this profile was last signed off in, and the gate on
     * promotion: a profile can only leave an environment it matches. After a
     * promotion it names the stage below, which is exactly what leaves the new
     * one unsigned without anything having to reset it.
     */
    val verifiedIn: EnvStage? = null,
    /** The ServiceNow change request authorising this profile's production release. */
    val rfcNumber: String? = null,
)

/** The part of a market that is persisted as a JSON document. */
data class MarketConfig(
    /** JSON key predates the behavior rename; kept so stored documents still read. */
    val customDimensionDefs: List<CustomBehaviorDef> = emptyList(),
    val profiles: List<MarketProfile> = emptyList(),
)

/** Country-specific attributes, grouped under `market` in the document. */
data class MarketInfo(
    val code: String,
    val name: String = "",
    val currency: String = "",
    val region: String = "",
)

// ---- environment readiness (derived on read, never persisted) ----

/** Follows the steps: nothing started, some checked, or all of them checked. */
enum class EnvOnboardingState { NOT_CONFIGURED, ONBOARDING_IN_PROGRESS, ONBOARDED }

enum class StepState { COMPLETE, IN_PROGRESS, PENDING }

/** One API exercised by the verify step, and whether it came back clean. */
data class ApiVerification(
    val name: String,
    val title: String,
    val verified: Boolean,
)

/**
 * One onboarding step for an environment. [apis] is only populated for the
 * verify step, which fans out over every API the profile carries.
 */
data class ReadinessStep(
    val key: String,
    val name: String,
    val description: String,
    val state: StepState,
    val apis: List<ApiVerification> = emptyList(),
)

/** A profile's standing in one environment; [state] follows from [steps]. */
data class EnvReadiness(
    val env: EnvStage,
    val state: EnvOnboardingState,
    val completedAt: Instant? = null,
    val steps: List<ReadinessStep> = emptyList(),
)

data class ProfileReadiness(
    val profileId: String,
    val accountType: AccountType,
    val environments: List<EnvReadiness> = emptyList(),
)

/** Full market document exchanged with the UI. Market status is derived from its profiles. */
data class MarketDocument(
    val market: MarketInfo,
    val status: EnvStage = EnvStage.E1,
    /** JSON key predates the behavior rename; kept so stored documents still read. */
    val customDimensionDefs: List<CustomBehaviorDef> = emptyList(),
    val profiles: List<MarketProfile> = emptyList(),
    /**
     * Derived from each profile's stage on read; never written back to storage.
     *
     * Nullable because it is output-only: clients POST and PUT documents without
     * it, and the deserializer does not fill in Kotlin defaults for absent
     * non-null fields.
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
 * No default on the property, deliberately: give every parameter one and Kotlin
 * synthesizes a no-arg constructor, which Jackson then prefers over the
 * parameter-name creator — leaving every `val` at its default and the request
 * looking empty however it was sent.
 */
data class RfcRequest(val rfcNumber: String)

data class CloneRequest(
    val targetCode: String,
    /** Account types to carry over; null or empty means all. */
    val accountTypes: List<AccountType>? = null,
)

// ---- revision history ----

enum class RevisionAction { CREATED, UPDATED, PROMOTED, VERIFIED, RFC_RECORDED, PROFILE_DELETED, CLONED }

/** One recorded change to a market, newest first when listed. */
data class MarketRevision(
    val id: Long,
    val action: RevisionAction,
    val actor: String,
    val summary: String,
    /**
     * The environments the change landed in. A profile's stage is where the
     * work on it is being done, so each environment keeps a history of its own
     * rather than three copies of the same list.
     */
    val envs: List<EnvStage> = emptyList(),
    val profileLabel: String? = null,
    val beforeJson: String? = null,
    val afterJson: String? = null,
    val at: Instant,
)
