package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.catalog.Catalog
import com.amex.billpay.onboarding.model.AccountType
import com.amex.billpay.onboarding.model.Behavior
import com.amex.billpay.onboarding.model.MarketConfig
import com.amex.billpay.onboarding.model.MarketProfile

/**
 * Turns a config-to-config change into one line a person can read.
 *
 * The stored document is an opaque JSON blob, so the before/after pair is kept
 * verbatim on the revision for anyone who wants the detail; this is the part
 * that makes the history scannable without opening it.
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

    fun verified(profile: MarketProfile): String =
        "${accountTypeLabel(profile.accountType)} verified in ${profile.status.name.lowercase()}"

    fun rfcRecorded(profile: MarketProfile, rfcNumber: String): String =
        "${accountTypeLabel(profile.accountType)} — change request $rfcNumber approved"

    fun promoted(promoted: List<MarketProfile>): String = when (promoted.size) {
        1 -> "${accountTypeLabel(promoted[0].accountType)} promoted to " +
            promoted[0].status.name.lowercase()
        else -> "${promoted.size} profiles promoted (" +
            promoted.joinToString { "${accountTypeLabel(it.accountType)} → ${it.status.name.lowercase()}" } + ")"
    }

    /** Diffs profiles and custom-behavior definitions; falls back to a generic line. */
    fun updated(before: MarketConfig, after: MarketConfig): String {
        val parts = mutableListOf<String>()

        val beforeByType = before.profiles.associateBy { it.accountType }
        val afterByType = after.profiles.associateBy { it.accountType }

        (afterByType.keys - beforeByType.keys).forEach {
            parts += "${accountTypeLabel(it)} profile added"
        }
        (beforeByType.keys - afterByType.keys).forEach {
            parts += "${accountTypeLabel(it)} profile removed"
        }
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

        if (before.status != after.status) {
            parts += "moved to ${after.status.name.lowercase()}"
        }
        return parts.joinToString(", ").ifBlank { null }
    }

    private fun behaviorDiff(before: Behavior, after: Behavior): List<String> = buildList {
        fun compare(key: String, old: Enum<*>, new: Enum<*>) {
            if (old != new) add("${behaviorLabel(key)} ${old.name} → ${new.name}")
        }
        compare("requiresArPosting", before.requiresArPosting, after.requiresArPosting)
        compare("requiresRealtimeClearing", before.requiresRealtimeClearing, after.requiresRealtimeClearing)
        compare("requiresMandateAuthorization", before.requiresMandateAuthorization, after.requiresMandateAuthorization)
        compare("requiresRepresentableReturn", before.requiresRepresentableReturn, after.requiresRepresentableReturn)
    }
}
