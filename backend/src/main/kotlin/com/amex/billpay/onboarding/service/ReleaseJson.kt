package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.catalog.Catalog
import com.amex.billpay.onboarding.model.AccountType
import com.amex.billpay.onboarding.model.BehaviorValue
import com.amex.billpay.onboarding.model.MarketProfile
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.JsonNodeFactory
import com.fasterxml.jackson.databind.node.ObjectNode
import java.security.MessageDigest

/**
 * The release JSON: a profile frozen as billpay-core's Router reads it from MARKET_CONFIG_VERSION.CONFIG_DA (wiki,
 * "The release JSON"; billpay-core `ReleaseConfig`). Keys with no value are left out, so billpay-core's own default
 * applies, and the corporate-only and bank-confirmation keys only go with a profile they apply to.
 */
object ReleaseJson {

    private val nodes = JsonNodeFactory.instance

    fun build(profile: MarketProfile, mapper: ObjectMapper): ObjectNode {
        val ops = profile.operations
        val root = nodes.objectNode()

        root.set<JsonNode>("apis", nodes.arrayNode().apply { Catalog.currentApiNames(profile.apis).sorted().forEach { add(it) } })

        val behaviors = nodes.objectNode()
        val b = profile.dimensions
        listOf(
            "requiresArPosting" to b.requiresArPosting,
            "requiresRealtimeClearing" to b.requiresRealtimeClearing,
            "requiresMandateAuthorization" to b.requiresMandateAuthorization,
            "requiresBankConfirmation" to b.requiresBankConfirmation,
        ).forEach { (key, value) ->
            val setting = nodes.objectNode().put("value", value.name)
            val byJourney = Catalog.behaviors.first { it.key == key }.bothRuleByJourney
            if (value == BehaviorValue.BOTH && byJourney) {
                setting.set<JsonNode>(
                    "yesForJourneys",
                    nodes.arrayNode().apply { ops.bothRules[key].orEmpty().distinct().sorted().forEach { add(it) } },
                )
            }
            behaviors.set<JsonNode>(key, setting)
        }
        root.set<JsonNode>("behaviors", behaviors)

        root.putIfSet("timeZone", ops.timeZone)
        root.putIfSet("executionTime", ops.executionTime)
        root.putIfSet("cancellationWindow", ops.cancellationWindow)
        root.putIfSet("executionCutoff", ops.executionCutoff)
        ops.executionFloorTps?.let { root.put("executionFloorTps", it) }
        if (profile.accountType == AccountType.CORPORATE) {
            root.putIfSet("allocationFetchBefore", ops.allocationFetchBefore)
            root.putIfSet("allocationAlertAfter", ops.allocationAlertAfter)
        }
        ops.representment?.let { root.set<JsonNode>("representment", mapper.valueToTree(it)) }
        ops.ravenStatuses?.let { list -> root.set<JsonNode>("ravenStatuses", strings(list)) }
        if (b.requiresBankConfirmation != BehaviorValue.N) {
            ops.bankConfirmation?.let { root.set<JsonNode>("bankConfirmation", withoutNulls(mapper.valueToTree(it))) }
        }
        ops.cardAuthentication?.let { root.set<JsonNode>("cardAuthentication", withoutNulls(mapper.valueToTree(it))) }
        root.put("payWithMrPoints", ops.payWithMrPoints)
        if (ops.enrolledInstrumentStatuses.isNotEmpty()) {
            val statuses = nodes.objectNode()
            ops.enrolledInstrumentStatuses.forEach { (context, list) -> statuses.set<JsonNode>(context, strings(list)) }
            root.set<JsonNode>("enrolledInstrumentStatuses", statuses)
        }
        root.putIfSet("pendingSweepAfter", ops.pendingSweepAfter)
        if (ops.testAccounts.isNotEmpty()) root.set<JsonNode>("testAccounts", strings(ops.testAccounts))
        ops.ruleSettings?.let { rules ->
            val node = withoutNulls(mapper.valueToTree(rules))
            if (node.size() > 0) root.set<JsonNode>("ruleSettings", node)
        }
        return canonical(root) as ObjectNode
    }

    /** `sha256:` and the hex digest of the canonical JSON, which is how billpay-core tells a repeat from a change. */
    fun checksum(json: String): String =
        "sha256:" + MessageDigest.getInstance("SHA-256").digest(json.toByteArray()).joinToString("") { "%02x".format(it) }

    /** The same JSON always serializes the same way: keys sorted at every level. */
    fun canonical(node: JsonNode): JsonNode = when {
        node.isObject -> nodes.objectNode().also { sorted ->
            node.fieldNames().asSequence().sorted().forEach { sorted.set<JsonNode>(it, canonical(node[it])) }
        }
        node.isArray -> nodes.arrayNode().also { array -> node.forEach { array.add(canonical(it)) } }
        else -> node
    }

    private fun strings(values: Collection<String>) = nodes.arrayNode().apply { values.forEach { add(it) } }

    private fun withoutNulls(node: JsonNode): ObjectNode {
        val copy = nodes.objectNode()
        node.properties().forEach { (k, v) -> if (!v.isNull) copy.set<JsonNode>(k, v) }
        return copy
    }

    private fun ObjectNode.putIfSet(key: String, value: String?) {
        if (!value.isNullOrBlank()) put(key, value.trim())
    }
}
