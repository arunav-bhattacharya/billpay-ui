package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.catalog.Catalog
import com.amex.billpay.onboarding.model.AccountType
import com.amex.billpay.onboarding.model.Behavior
import com.amex.billpay.onboarding.model.MarketConfig
import com.amex.billpay.onboarding.model.MarketProfile
import com.amex.billpay.onboarding.model.OperationsSettings
import kotlin.reflect.full.memberProperties

/**
 * Turns a config-to-config change into one line a person can read. The before/after pair is kept verbatim on the
 * revision for anyone who wants the detail; this is the part that makes the history scannable.
 */
object RevisionSummary {

    fun accountTypeLabel(type: AccountType): String =
        Catalog.accountTypes.firstOrNull { it.key == type.name }?.label ?: type.name

    private fun behaviorLabel(key: String): String =
        Catalog.behaviors.firstOrNull { it.key == key }?.label ?: key

    fun created(config: MarketConfig): String {
        val types = config.profiles.joinToString { accountTypeLabel(it.accountType) }
        return when (config.profiles.size) {
            0 -> "Market onboarded with no profiles"
            1 -> "Market onboarded with the $types profile"
            else -> "Market onboarded with ${config.profiles.size} profiles ($types)"
        }
    }

    fun cloned(sourceName: String, profiles: List<MarketProfile>): String =
        "Cloned from $sourceName (${profiles.joinToString { accountTypeLabel(it.accountType) }})"

    fun profileDeleted(profile: MarketProfile): String =
        "${accountTypeLabel(profile.accountType)} profile removed"

    /** Diffs profiles and custom-behavior definitions; falls back to a generic line. */
    fun updated(before: MarketConfig, after: MarketConfig): String {
        val parts = mutableListOf<String>()

        val beforeByType = before.profiles.associateBy { it.accountType }
        val afterByType = after.profiles.associateBy { it.accountType }

        (afterByType.keys - beforeByType.keys).forEach { parts += "${accountTypeLabel(it)} profile added" }
        (beforeByType.keys - afterByType.keys).forEach { parts += "${accountTypeLabel(it)} profile removed" }
        (beforeByType.keys intersect afterByType.keys).forEach { type ->
            profileDiff(beforeByType.getValue(type), afterByType.getValue(type))?.let {
                parts += "${accountTypeLabel(type)} — $it"
            }
        }

        val beforeDefs = before.customDimensionDefs.map { it.key }.toSet()
        val afterDefs = after.customDimensionDefs.map { it.key }.toSet()
        (afterDefs - beforeDefs).forEach { parts += "custom behavior '$it' defined" }
        (beforeDefs - afterDefs).forEach { parts += "custom behavior '$it' removed" }

        return parts.joinToString("; ").ifBlank { "Market updated" }
    }

    private fun profileDiff(before: MarketProfile, after: MarketProfile): String? {
        val parts = mutableListOf<String>()

        val addedApis = after.apis - before.apis.toSet()
        val removedApis = before.apis - after.apis.toSet()
        if (addedApis.isNotEmpty()) parts += "added ${addedApis.joinToString()}"
        if (removedApis.isNotEmpty()) parts += "removed ${removedApis.joinToString()}"

        behaviorDiff(before.dimensions, after.dimensions).forEach { parts += it }

        val keys = before.customDimensions.keys + after.customDimensions.keys
        keys.forEach { key ->
            val old = before.customDimensions[key]
            val new = after.customDimensions[key]
            if (old != new) parts += "$key ${old ?: "unset"} → ${new ?: "unset"}"
        }

        operationsDiff(before.operations, after.operations).takeIf { it.isNotEmpty() }?.let {
            parts += "operations: ${it.joinToString()}"
        }
        return parts.joinToString(", ").ifBlank { null }
    }

    private fun behaviorDiff(before: Behavior, after: Behavior): List<String> =
        listOf(
            Triple("requiresArPosting", before.requiresArPosting, after.requiresArPosting),
            Triple("requiresRealtimeClearing", before.requiresRealtimeClearing, after.requiresRealtimeClearing),
            Triple("requiresMandateAuthorization", before.requiresMandateAuthorization, after.requiresMandateAuthorization),
            Triple("requiresBankConfirmation", before.requiresBankConfirmation, after.requiresBankConfirmation),
        ).mapNotNull { (key, old, new) -> if (old != new) "${behaviorLabel(key)} $old → $new" else null }

    /** The Operations settings' keys that changed, by name; the revision's JSON holds the values. */
    private fun operationsDiff(before: OperationsSettings, after: OperationsSettings): List<String> =
        OperationsSettings::class.memberProperties.filter { it.get(before) != it.get(after) }.map { it.name }.sorted()
}
