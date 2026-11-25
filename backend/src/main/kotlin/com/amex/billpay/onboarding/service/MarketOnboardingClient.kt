package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.ReleaseStatus
import com.amex.billpay.onboarding.model.ReleaseStep
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.io.IOException
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.HttpTimeoutException
import java.time.Duration
import java.time.Instant

/** billpay-core's answer to a release: its workflow and status. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class ReleaseAccepted(val workflowId: String = "", val status: ReleaseStatus = ReleaseStatus.REQUESTED)

/** billpay-core's `GET /market-onboarding/releases/{market}/{account-type}/{version}`. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class ReleaseProgress(
    val workflowId: String? = null,
    val status: ReleaseStatus = ReleaseStatus.REQUESTED,
    val step: ReleaseStep? = null,
    val reason: String? = null,
    val needsBuild: Boolean = false,
    val replacedVersion: Int? = null,
)

/** One combination the deployed build can run: an account type and Y or N for the four behaviors. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class Capability(
    val accountType: String = "",
    val requiresArPosting: String = "N",
    val requiresRealtimeClearing: String = "N",
    val requiresMandateAuthorization: String = "N",
    val requiresBankConfirmation: String = "N",
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class Capabilities(val buildVersion: String = "", val combinations: List<Capability> = emptyList())

/**
 * A call the environment refused or couldn't take. [status] is billpay-core's HTTP status, or null when the API
 * couldn't be reached at all; [detail] is its Problem's detail, or what went wrong on the way.
 */
class OnboardingApiException(val env: EnvStage, val status: Int?, val detail: String) : RuntimeException(detail)

/**
 * One environment's Market Onboarding API, served by its billpay-offline (wiki, "Market Onboarding API"; bodies
 * Proposed 2026-10-18). Only billpay-ui's backend calls it, with its own service identity; `TODO(current-app)`: until
 * the company's environment says how that identity is checked, billpay-core takes no credential, so none is sent.
 *
 * A request waits at most [timeout]: billpay-core bounds its own calls to the Offline cluster at 5 s and answers 503
 * after that, so this sits just above it.
 */
class MarketOnboardingClient(
    val env: EnvStage,
    val baseUrl: String,
    private val mapper: ObjectMapper,
    private val timeout: Duration = Duration.ofSeconds(8),
) {
    private val http: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()

    fun send(market: String, accountType: String, version: Int, checksum: String, config: JsonNode, author: String?, approver: String?): ReleaseAccepted {
        val body = mapper.createObjectNode()
            .put("market", market)
            .put("accountType", accountType)
            .put("version", version)
            .put("checksum", checksum)
            .also { it.set<JsonNode>("config", config) }
            .put("author", author)
            .put("approver", approver)
        return mapper.readValue(call("POST", "/market-onboarding/releases", body).body(), ReleaseAccepted::class.java)
    }

    /** The release's progress, or null when this environment has no such release. */
    fun status(market: String, accountType: String, version: Int): ReleaseProgress? {
        val response = call("GET", release(market, accountType, version), null, allowNotFound = true)
        if (response.statusCode() == 404) return null
        return mapper.readValue(response.body(), ReleaseProgress::class.java)
    }

    fun signOff(market: String, accountType: String, version: Int, by: String, at: Instant, rfc: String?) {
        val body = mapper.createObjectNode().put("signedOffBy", by).put("signedOffAt", at.toString())
        if (rfc != null) body.put("rfc", rfc)
        call("POST", release(market, accountType, version) + "/sign-off", body)
    }

    fun rollback(market: String, accountType: String, version: Int, by: String, reason: String?) {
        call("POST", release(market, accountType, version) + "/rollback", control(by, reason))
    }

    fun pause(market: String, accountType: String, by: String, reason: String?) {
        call("POST", "/market-onboarding/markets/${seg(market)}/${seg(accountType)}/pause", control(by, reason))
    }

    fun resume(market: String, accountType: String, by: String, reason: String?) {
        call("POST", "/market-onboarding/markets/${seg(market)}/${seg(accountType)}/resume", control(by, reason))
    }

    fun capabilities(): Capabilities =
        mapper.readValue(call("GET", "/market-onboarding/capabilities", null).body(), Capabilities::class.java)

    private fun release(market: String, accountType: String, version: Int) =
        "/market-onboarding/releases/${seg(market)}/${seg(accountType)}/$version"

    private fun control(by: String, reason: String?) =
        mapper.createObjectNode().put("requestedBy", by).also { if (!reason.isNullOrBlank()) it.put("reason", reason) }

    private fun seg(value: String) = URLEncoder.encode(value, Charsets.UTF_8)

    private fun call(method: String, path: String, body: JsonNode?, allowNotFound: Boolean = false): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI.create(baseUrl.trimEnd('/') + path))
            .timeout(timeout)
            .header("Accept", "application/json")
            .apply {
                if (body != null) {
                    header("Content-Type", "application/json")
                    method(method, HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                } else {
                    method(method, HttpRequest.BodyPublishers.noBody())
                }
            }
            .build()
        val response = try {
            http.send(request, HttpResponse.BodyHandlers.ofString())
        } catch (e: HttpTimeoutException) {
            throw OnboardingApiException(env, null, "${label()} didn't answer within ${timeout.seconds} s")
        } catch (e: IOException) {
            throw OnboardingApiException(env, null, "${label()} at $baseUrl can't be reached")
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw OnboardingApiException(env, null, "${label()}: the call was interrupted")
        }
        val code = response.statusCode()
        if (code in 200..299 || (allowNotFound && code == 404)) return response
        throw OnboardingApiException(env, code, problem(response))
    }

    /** billpay-core's Problem body is `{reason, detail}`; a 503 also says when to try again. */
    private fun problem(response: HttpResponse<String>): String {
        val detail = runCatching { mapper.readTree(response.body())?.get("detail")?.asText() }.getOrNull()
            ?.takeIf { it.isNotBlank() }
        return when (response.statusCode()) {
            503 -> {
                val retry = response.headers().firstValue("Retry-After").orElse(null)
                "${label()}'s Offline cluster is unavailable" + (retry?.let { "; try again in $it s" } ?: "")
            }
            else -> detail ?: "${label()} answered ${response.statusCode()}"
        }
    }

    private fun label() = "${env.name.lowercase()}'s Market Onboarding API"
}
