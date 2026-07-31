package com.amex.billpay.onboarding.model

import com.fasterxml.jackson.annotation.JsonCreator
import java.time.Instant
import java.util.UUID

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

enum class CustomDimensionType { BOOLEAN, ENUM, TEXT }

/**
 * A dimension's setting. [BOTH] means the market requires the behaviour for
 * some flows and not others, so it is not reducible to a single yes or no.
 */
enum class DimValue {
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
        fun from(raw: Any?): DimValue = when (raw) {
            null -> N
            is Boolean -> if (raw) Y else N
            is String -> when (raw.uppercase()) {
                "Y", "TRUE" -> Y
                "N", "FALSE", "" -> N
                "BOTH", "B" -> BOTH
                else -> throw IllegalArgumentException("Unknown dimension value '$raw'")
            }
            else -> throw IllegalArgumentException("Unsupported dimension value: $raw")
        }
    }
}

/** The standard processing dimensions minus accountType, which lives on the profile. */
data class Dimensions(
    val requiresArPosting: DimValue = DimValue.N,
    val requiresRealtimeClearing: DimValue = DimValue.N,
    val requiresMandateAuthorization: DimValue = DimValue.N,
    /** Only meaningful when realtime clearing is not [DimValue.Y]; never [DimValue.BOTH]. */
    val requiresRepresentableReturn: DimValue = DimValue.N,
)

/** Admin-defined, market-scoped custom dimension definition. */
data class CustomDimensionDef(
    val key: String,
    val label: String,
    val type: CustomDimensionType,
    val allowedValues: List<String> = emptyList(),
    val description: String? = null,
)

/** One combination of accountType + dimensions + API selection within a market. */
data class MarketProfile(
    val id: String = UUID.randomUUID().toString(),
    val accountType: AccountType,
    val status: EnvStage = EnvStage.E1,
    val apis: List<String> = emptyList(),
    val dimensions: Dimensions = Dimensions(),
    val customDimensions: Map<String, String> = emptyMap(),
)

/** The part of a market that is persisted as a JSON document. */
data class MarketConfig(
    val customDimensionDefs: List<CustomDimensionDef> = emptyList(),
    val profiles: List<MarketProfile> = emptyList(),
)

/** Country-specific attributes, grouped under `market` in the document. */
data class MarketInfo(
    val code: String,
    val name: String = "",
    val currency: String = "",
    val region: String = "",
)

/** Full market document exchanged with the UI. Market status is derived from its profiles. */
data class MarketDocument(
    val market: MarketInfo,
    val status: EnvStage = EnvStage.E1,
    val customDimensionDefs: List<CustomDimensionDef> = emptyList(),
    val profiles: List<MarketProfile> = emptyList(),
    val createdAt: Instant? = null,
    val updatedAt: Instant? = null,
)

data class CloneRequest(
    val targetCode: String,
    /** Account types to carry over; null or empty means all. */
    val accountTypes: List<AccountType>? = null,
)
