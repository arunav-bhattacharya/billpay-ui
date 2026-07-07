package com.amex.billpay.onboarding.model

import java.time.Instant
import java.util.UUID

enum class AccountType { CONSUMER, CORPORATE, SMALL_BUSINESS }

enum class LifecycleStatus { DRAFT, ACTIVE }

enum class CustomDimensionType { BOOLEAN, ENUM, TEXT }

/** The four standard processing dimensions minus accountType, which lives on the profile. */
data class Dimensions(
    val requiresArPosting: Boolean = false,
    val requiresRealtimeClearing: Boolean = false,
    val requiresMandateAuthorization: Boolean = false,
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
    val status: LifecycleStatus = LifecycleStatus.DRAFT,
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
    val status: LifecycleStatus = LifecycleStatus.DRAFT,
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
