package com.amex.billpay.onboarding

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager
import java.net.InetSocketAddress
import java.time.Duration
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * A stand-in for billpay-offline's Market Onboarding API, as billpay-core's MarketOnboarding.kt and
 * MarketOnboardingWorkflow.kt behave: a release walks CHECK, SAVE, TEST to WAITING_FOR_SIGN_OFF on the clock, a
 * sign-off activates it and supersedes the version it replaced, a rollback restores that one, and pause and resume act
 * on a live market. It answers with billpay-core's status codes and `{reason, detail}` problems.
 */
object FakeOnboardingApi {
    private val mapper: ObjectMapper = jacksonObjectMapper()
    private lateinit var server: HttpServer

    /** What arrived, newest last: method, path and body. */
    val calls = CopyOnWriteArrayList<Triple<String, String, JsonNode?>>()

    /** While set, every call but the capabilities answers 503, as while the Offline cluster is down. */
    @Volatile var down = false

    /** Each step's length in this fake's clock. */
    var beat: Duration = Duration.ofMillis(60)

    private class Workflow(
        val market: String,
        val type: String,
        val version: Int,
        val checksum: String,
        val config: JsonNode,
        val sentAt: Instant,
    ) {
        var signedOffAt: Instant? = null
        var status = "REQUESTED"
        var step: String? = null
        var reason: String? = null
        var replaced: Int? = null
        var rollbackAt: Instant? = null
        val id get() = "onboard-$market-$type-v$version"
    }

    private val workflows = ConcurrentHashMap<String, Workflow>()
    private val active = ConcurrentHashMap<String, Int>()

    fun reset() {
        calls.clear()
        workflows.clear()
        active.clear()
        down = false
    }

    fun start(): String {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/market-onboarding") { handle(it) }
        server.start()
        return "http://127.0.0.1:${server.address.port}"
    }

    fun stop() = server.stop(0)

    private fun handle(x: HttpExchange) {
        val path = x.requestURI.path.removePrefix("/market-onboarding")
        val body = x.requestBody.readBytes().takeIf { it.isNotEmpty() }?.let { mapper.readTree(it) }
        calls += Triple(x.requestMethod, path, body)
        val parts = path.trim('/').split('/')
        try {
            when {
                path == "/capabilities" -> reply(x, 200, capabilities())
                down -> {
                    x.responseHeaders.add("Retry-After", "30")
                    problem(x, 503, "UNAVAILABLE", "The Offline cluster is down")
                }
                x.requestMethod == "POST" && path == "/releases" -> send(x, body!!)
                x.requestMethod == "GET" && parts[0] == "releases" && parts.size == 4 -> status(x, parts[1], type(parts[2]), parts[3].toInt())
                x.requestMethod == "POST" && parts[0] == "releases" && parts.getOrNull(4) == "sign-off" -> signOff(x, key(parts[1], type(parts[2]), parts[3].toInt()), body)
                x.requestMethod == "POST" && parts[0] == "releases" && parts.getOrNull(4) == "rollback" -> rollback(x, key(parts[1], type(parts[2]), parts[3].toInt()))
                x.requestMethod == "POST" && parts[0] == "markets" && parts.size == 4 -> control(x, parts[1], type(parts[2]), body)
                else -> problem(x, 404, "NOT_FOUND", "no such path")
            }
        } catch (e: Exception) {
            problem(x, 500, "ERROR", e.message ?: "fake failed")
        }
    }

    private fun type(raw: String) = if (raw == "BUSINESS_TRAVEL_ACCOUNT") "BUSINESS_TRAVEL" else raw

    private fun key(market: String, type: String, version: Int) = "onboard-$market-$type-v$version"

    private fun send(x: HttpExchange, body: JsonNode) {
        val market = body["market"]?.asText()
        val type = body["accountType"]?.asText()
        if (market.isNullOrBlank() || type !in setOf("CONSUMER", "CORPORATE", "BUSINESS_TRAVEL")) {
            return problem(x, 400, "INVALID_REQUEST", "accountType is CONSUMER, CORPORATE or BUSINESS_TRAVEL")
        }
        val w = Workflow(market, type!!, body["version"].asInt(), body["checksum"].asText(), body["config"], Instant.now())
        val existing = workflows.putIfAbsent(w.id, w)
        if (existing != null && existing.checksum != w.checksum) {
            return problem(x, 409, "CONFLICT", "v${w.version} of $market $type was sent with another checksum")
        }
        reply(x, 202, mapOf("workflowId" to w.id, "status" to "REQUESTED"))
    }

    private fun advance(w: Workflow) {
        val since = Duration.between(w.sentAt, Instant.now())
        val now = Instant.now()
        if (w.status in setOf("REQUESTED", "RUNNING") && w.signedOffAt == null && w.rollbackAt == null) {
            val window = w.config["cancellationWindow"]?.asText()?.let { Duration.parse(it) }
            when {
                since >= beat.multipliedBy(2) && window != null && !window.isPositive -> {
                    w.status = "FAILED"; w.step = "CHECK"; w.reason = "cancellationWindow $window doesn't close before the execution time"
                }
                since >= beat.multipliedBy(4) -> { w.status = "WAITING_FOR_SIGN_OFF"; w.step = "WAIT" }
                since >= beat.multipliedBy(3) -> { w.status = "RUNNING"; w.step = "TEST" }
                since >= beat.multipliedBy(2) -> { w.status = "RUNNING"; w.step = "SAVE" }
                since >= beat -> { w.status = "RUNNING"; w.step = "CHECK" }
            }
        }
        val signed = w.signedOffAt
        if (w.status == "RUNNING" && w.step == "ACTIVATE" && signed != null && Duration.between(signed, now) >= beat) {
            val k = "${w.market}-${w.type}"
            val previous = active[k]
            active[k] = w.version
            previous?.let { workflows[key(w.market, w.type, it)]?.apply { status = "SUPERSEDED"; reason = "v${w.version} is active now" } }
            w.replaced = previous
            w.status = "ACTIVE"
            w.step = null
        }
        val rolled = w.rollbackAt
        if (w.status == "RUNNING" && w.step == "ROLLBACK" && rolled != null && Duration.between(rolled, now) >= beat) {
            active["${w.market}-${w.type}"] = w.replaced!!
            w.status = "ROLLED_BACK"
            w.step = null
        }
    }

    private fun status(x: HttpExchange, market: String, type: String, version: Int) {
        val w = workflows[key(market, type, version)] ?: return problem(x, 404, "NOT_FOUND", "no such release or live market")
        advance(w)
        // A version a later one's rollback restored is active again, though its own workflow ended superseded.
        val status = if (w.status == "SUPERSEDED" && active["$market-$type"] == version) "ACTIVE" else w.status
        reply(
            x, 200,
            mapOf(
                "workflowId" to w.id, "status" to status, "step" to w.step, "reason" to w.reason,
                "needsBuild" to false, "replacedVersion" to w.replaced,
            ),
        )
    }

    private fun signOff(x: HttpExchange, id: String, body: JsonNode?) {
        val w = workflows[id] ?: return problem(x, 409, "CONFLICT", "the release is unknown")
        advance(w)
        if (body?.get("signedOffBy")?.asText().isNullOrBlank()) return problem(x, 400, "INVALID_REQUEST", "a sign-off names who signed off")
        if (w.status != "WAITING_FOR_SIGN_OFF") return problem(x, 409, "CONFLICT", "the release isn't waiting for a sign-off: ${w.status}")
        w.signedOffAt = Instant.now()
        w.status = "RUNNING"
        w.step = "ACTIVATE"
        reply(x, 202, null)
    }

    private fun rollback(x: HttpExchange, id: String) {
        val w = workflows[id] ?: return problem(x, 409, "CONFLICT", "the release is unknown")
        advance(w)
        if (w.status != "ACTIVE") return problem(x, 409, "CONFLICT", "the release isn't active: ${w.status}")
        if (w.replaced == null) return problem(x, 409, "CONFLICT", "the release replaced no version, so there is none to roll back to")
        w.rollbackAt = Instant.now()
        w.status = "RUNNING"
        w.step = "ROLLBACK"
        reply(x, 202, null)
    }

    private fun control(x: HttpExchange, market: String, type: String, body: JsonNode?) {
        if (body?.get("requestedBy")?.asText().isNullOrBlank()) return problem(x, 400, "INVALID_REQUEST", "names who asked for it")
        if (active["$market-$type"] == null) return problem(x, 404, "NOT_FOUND", "no such release or live market")
        reply(x, 202, null)
    }

    /** Every combination but corporate with mandate authorization, so a check can find one missing. */
    private fun capabilities(): Map<String, Any> {
        val values = listOf("N", "Y")
        val combinations = listOf("CONSUMER", "CORPORATE", "BUSINESS_TRAVEL").flatMap { type ->
            values.flatMap { ar -> values.flatMap { rt -> values.flatMap { ma -> values.map { bank -> listOf(type, ar, rt, ma, bank) } } } }
        }.filterNot { it[0] == "CORPORATE" && it[3] == "Y" }.map {
            mapOf(
                "accountType" to it[0], "requiresArPosting" to it[1], "requiresRealtimeClearing" to it[2],
                "requiresMandateAuthorization" to it[3], "requiresBankConfirmation" to it[4],
            )
        }
        return mapOf("buildVersion" to "fake-1.0", "combinations" to combinations)
    }

    private fun problem(x: HttpExchange, code: Int, reason: String, detail: String) = reply(x, code, mapOf("reason" to reason, "detail" to detail))

    private fun reply(x: HttpExchange, code: Int, body: Any?) {
        val bytes = body?.let { mapper.writeValueAsBytes(it) } ?: ByteArray(0)
        x.responseHeaders.add("Content-Type", "application/json")
        x.sendResponseHeaders(code, if (bytes.isEmpty()) -1 else bytes.size.toLong())
        if (bytes.isNotEmpty()) x.responseBody.use { it.write(bytes) } else x.close()
    }
}

/** Starts [FakeOnboardingApi] and points e1 at it; e2 and e3 stay simulated. */
class FakeOnboardingApiResource : QuarkusTestResourceLifecycleManager {
    override fun start(): Map<String, String> = mapOf("billpay.environments.e1.url" to FakeOnboardingApi.start())

    override fun stop() = FakeOnboardingApi.stop()
}
