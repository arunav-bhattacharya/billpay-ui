package com.amex.billpay.onboarding

import io.quarkus.test.common.QuarkusTestResource
import io.quarkus.test.junit.QuarkusTest
import io.restassured.RestAssured.given
import io.restassured.http.ContentType
import io.restassured.path.json.JsonPath
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Duration

/**
 * The release pipeline end to end: e1 against a fake billpay-offline ([FakeOnboardingApi]), e2 and e3 simulated.
 * Each test onboards a market of its own.
 */
@QuarkusTest
@QuarkusTestResource(FakeOnboardingApiResource::class, restrictToAnnotatedClass = true)
class ReleaseFlowTest {

    @BeforeEach
    fun reset() = FakeOnboardingApi.reset()

    // ---- helpers ----

    private fun profile(type: String = "CONSUMER", executionTime: String = "01:00", extra: Map<String, Any?> = emptyMap()) = mapOf(
        "accountType" to type,
        "apis" to listOf("CreatePayment.v3", "UpdatePayment.v1", "DeletePayment.v1"),
        "dimensions" to mapOf("requiresArPosting" to "Y", "requiresRealtimeClearing" to "BOTH"),
        "operations" to mapOf("timeZone" to "Europe/Berlin", "executionTime" to executionTime) + extra,
    )

    private fun onboard(code: String, vararg profiles: Map<String, Any?>): JsonPath =
        given().contentType(ContentType.JSON).header("X-Billpay-Role", "OPERATOR")
            .body(mapOf("market" to mapOf("code" to code), "profiles" to profiles.toList()))
            .post("/api/markets").then().statusCode(201).extract().jsonPath()

    private fun market(code: String): JsonPath = given().get("/api/markets/$code").then().statusCode(200).extract().jsonPath()

    private fun profileId(code: String, i: Int = 0): String = market(code).getString("profiles[$i].id")

    private fun act(code: String, path: String, body: Any? = null, role: String = "APPROVER") =
        given().contentType(ContentType.JSON).header("X-Billpay-Role", role)
            .body(body ?: emptyMap<String, Any>())
            .post("/api/markets/$code/profiles/${profileId(code)}/$path")

    /** The newest deployment in [env] of the market's first profile. */
    private fun current(code: String, env: String, field: String): String? =
        market(code).getString("readiness[0].environments.find { it.env == '$env' }.current.$field")

    private fun live(code: String, env: String): String? =
        market(code).getString("readiness[0].environments.find { it.env == '$env' }.live.version")

    private fun awaitStatus(code: String, env: String, status: String) =
        await().atMost(Duration.ofSeconds(15)).pollInterval(Duration.ofMillis(100)).until { current(code, env, "status") == status }

    private fun history(code: String, env: String): List<Map<String, Any?>> =
        market(code).getList("readiness[0].environments.find { it.env == '$env' }.history")

    private fun sent(path: String) = FakeOnboardingApi.calls.filter { it.second == path }

    // ---- the tests ----

    @Test
    fun `a release goes live in e1, a second version takes over, and a rollback restores the first`() {
        onboard("DE", profile())
        assertEquals(null, market("DE").getString("liveIn"), "a draft is live nowhere")
        act("DE", "release", role = "OPERATOR").then().statusCode(409).body("error", org.hamcrest.Matchers.containsString("someone else approves"))
        assertTrue(FakeOnboardingApi.calls.isEmpty(), "an author's own release never leaves billpay-ui")
        act("DE", "release").then().statusCode(200)

        val send = sent("/releases").single().third!!
        assertEquals("DE", send["market"].asText())
        assertEquals("CONSUMER", send["accountType"].asText())
        assertEquals(1, send["version"].asInt())
        assertTrue(send["checksum"].asText().startsWith("sha256:"))
        assertEquals("OPERATOR", send["author"].asText(), "the author is who last edited the draft")
        assertEquals("APPROVER", send["approver"].asText(), "the approver is who released it")
        val config = send["config"]
        assertEquals("Y", config["behaviors"]["requiresArPosting"]["value"].asText())
        assertEquals("BOTH", config["behaviors"]["requiresRealtimeClearing"]["value"].asText())
        assertEquals("N", config["behaviors"]["requiresBankConfirmation"]["value"].asText())
        assertEquals("Europe/Berlin", config["timeZone"].asText())
        assertEquals("onboard-DE-CONSUMER-v1", current("DE", "E1", "workflowId"))

        awaitStatus("DE", "E1", "WAITING_FOR_SIGN_OFF")
        assertEquals("WAIT", current("DE", "E1", "step"))
        act("DE", "release").then().statusCode(409)
        act("DE", "environments/E1/sign-off").then().statusCode(200)
        awaitStatus("DE", "E1", "ACTIVE")
        assertEquals("APPROVER", current("DE", "E1", "signedOffBy"))
        assertEquals("E1", market("DE").getString("liveIn"), "live means a version is active there")
        assertEquals("E1", market("DE").getString("readiness[0].liveIn"))
        act("DE", "environments/E1/sign-off").then().statusCode(409)
        act("DE", "environments/E1/rollback", mapOf("reason" to "nothing to go back to")).then().statusCode(409)
        assertFalse(market("DE").getBoolean("readiness[0].draftChanged"))

        // v2: a later run, so the draft differs and the next release freezes a new version.
        val doc = market("DE").getMap<String, Any>("")
        val edited = doc + ("profiles" to listOf(
            (market("DE").getMap<String, Any>("profiles[0]")) + ("operations" to mapOf("timeZone" to "Europe/Berlin", "executionTime" to "02:00")),
        ))
        given().contentType(ContentType.JSON).body(edited - "readiness").put("/api/markets/DE").then().statusCode(200)
        assertTrue(market("DE").getBoolean("readiness[0].draftChanged"))
        act("DE", "release").then().statusCode(200)
        awaitStatus("DE", "E1", "WAITING_FOR_SIGN_OFF")
        assertEquals("1", live("DE", "E1"), "v1 runs until v2 is signed off")
        act("DE", "environments/E1/sign-off").then().statusCode(200)
        awaitStatus("DE", "E1", "ACTIVE")
        assertEquals("1", current("DE", "E1", "replacedVersion"))
        await().atMost(Duration.ofSeconds(5)).until { history("DE", "E1").any { it["version"] == 1 && it["status"] == "SUPERSEDED" } }

        act("DE", "environments/E1/rollback", mapOf("reason" to "the 02:00 run clashes")).then().statusCode(200)
        awaitStatus("DE", "E1", "ROLLED_BACK")
        await().atMost(Duration.ofSeconds(5)).until { live("DE", "E1") == "1" }
        assertEquals("the 02:00 run clashes", sent("/releases/DE/CONSUMER/2/rollback").single().third!!["reason"].asText())

        act("DE", "environments/E1/pause", mapOf("reason" to "bank holiday")).then().statusCode(200)
        assertEquals("APPROVER", sent("/markets/DE/CONSUMER/pause").single().third!!["requestedBy"].asText())
        assertTrue(market("DE").getBoolean("readiness[0].environments.find { it.env == 'E1' }.control.paused"))
        act("DE", "environments/E1/resume").then().statusCode(200)
        assertFalse(market("DE").getBoolean("readiness[0].environments.find { it.env == 'E1' }.control.paused"))

        val actions = given().get("/api/markets/DE/revisions").jsonPath().getList<String>("action")
        listOf("RELEASED", "ACTIVATED", "VERIFIED", "ROLLED_BACK", "PAUSED", "RESUMED").forEach {
            assertTrue(it in actions, "$it in $actions")
        }
    }

    @Test
    fun `the same version is promoted through simulated e2 and e3, and e3 signs off only with an RFC`() {
        onboard("NL", profile())
        act("NL", "release")
        awaitStatus("NL", "E1", "WAITING_FOR_SIGN_OFF")
        act("NL", "environments/E2/promote").then().statusCode(409)
        act("NL", "environments/E1/promote").then().statusCode(409)
        act("NL", "environments/E1/sign-off")
        awaitStatus("NL", "E1", "ACTIVE")

        act("NL", "environments/E1/promote").then().statusCode(200)
        assertEquals("true", current("NL", "E2", "simulated"))
        assertEquals("E2", market("NL").getString("profiles[0].status"))
        act("NL", "environments/E1/promote").then().statusCode(409)
        awaitStatus("NL", "E2", "WAITING_FOR_SIGN_OFF")
        act("NL", "environments/E2/sign-off").then().statusCode(200)
        awaitStatus("NL", "E2", "ACTIVE")

        act("NL", "environments/E2/promote").then().statusCode(200)
        awaitStatus("NL", "E3", "WAITING_FOR_SIGN_OFF")
        act("NL", "environments/E3/sign-off").then().statusCode(409)
        act("NL", "rfc", mapOf("rfcNumber" to "  ")).then().statusCode(400)
        act("NL", "rfc", mapOf("rfcNumber" to "CHG0012345")).then().statusCode(200)
        assertEquals("CHG0012345", current("NL", "E3", "rfc"))
        act("NL", "environments/E3/sign-off").then().statusCode(200)
        awaitStatus("NL", "E3", "ACTIVE")
        assertEquals("E3", market("NL").getString("status"))
        assertEquals(1, sent("/releases").size, "only e1 is a real environment here")
    }

    @Test
    fun `a release e1 can't take for now is sent again, and one it refuses fails`() {
        onboard("FR", profile())
        FakeOnboardingApi.down = true
        act("FR", "release").then().statusCode(200)
        assertEquals("REQUESTED", current("FR", "E1", "status"))
        assertTrue(current("FR", "E1", "lastError")!!.contains("unavailable"), current("FR", "E1", "lastError"))
        FakeOnboardingApi.down = false
        awaitStatus("FR", "E1", "WAITING_FOR_SIGN_OFF")
        assertEquals(null, current("FR", "E1", "lastError"))

        // Step 1 stops a release whose cancellation window doesn't close before its run.
        onboard("IT", profile(extra = mapOf("cancellationWindow" to "PT0S")))
        act("IT", "release")
        awaitStatus("IT", "E1", "FAILED")
        assertEquals("CHECK", current("IT", "E1", "step"))
        assertTrue(current("IT", "E1", "reason")!!.contains("cancellationWindow"))
        val failed = market("IT").getList<Map<String, Any?>>("readiness[0].environments.find { it.env == 'E1' }.steps")
        assertEquals("FAILED", failed.first { it["key"] == "CHECK" }["state"])
        // The same draft goes out again as a new version: a failed one never runs again.
        act("IT", "release").then().statusCode(200)
        assertEquals("2", current("IT", "E1", "version"))
    }

    @Test
    fun `business travel goes out as BUSINESS_TRAVEL and corporate keys only with a corporate release`() {
        onboard(
            "SE",
            profile("BUSINESS_TRAVEL_ACCOUNT", extra = mapOf("allocationFetchBefore" to "PT2H")),
            profile("CORPORATE", extra = mapOf("allocationFetchBefore" to "PT2H")),
        )
        act("SE", "release")
        val first = sent("/releases").single().third!!
        // The first profile in account-type order is corporate.
        assertEquals("CORPORATE", first["accountType"].asText())
        assertEquals("PT2H", first["config"]["allocationFetchBefore"].asText())
        val bt = profileId("SE", 1)
        given().contentType(ContentType.JSON).header("X-Billpay-Role", "APPROVER").body("{}").post("/api/markets/SE/profiles/$bt/release").then().statusCode(200)
        val second = sent("/releases").last().third!!
        assertEquals("BUSINESS_TRAVEL", second["accountType"].asText())
        assertFalse(second["config"].has("allocationFetchBefore"))
        await().atMost(Duration.ofSeconds(10)).until { FakeOnboardingApi.calls.any { it.second == "/releases/SE/BUSINESS_TRAVEL/1" } }
    }

    @Test
    fun `a profile live in a real environment can't be deleted, and the manifest comes from e1`() {
        onboard("BE", profile())
        act("BE", "release")
        awaitStatus("BE", "E1", "WAITING_FOR_SIGN_OFF")
        act("BE", "environments/E1/sign-off")
        awaitStatus("BE", "E1", "ACTIVE")
        given().delete("/api/markets/BE/profiles/${profileId("BE")}").then().statusCode(409)
        given().delete("/api/markets/BE").then().statusCode(409)

        val manifest = given().get("/api/environments/E1/capabilities").then().statusCode(200).extract().jsonPath()
        assertEquals("fake-1.0", manifest.getString("buildVersion"))
        assertNotNull(manifest.getList<Any>("combinations").firstOrNull())
        given().get("/api/environments/E2/capabilities").then().statusCode(404)
        val live = given().get("/api/environments/E1/live").then().statusCode(200).extract().jsonPath()
        assertEquals("Europe/Berlin", live.getString("find { it.market == 'BE' }.config.timeZone"))
        assertEquals(1, live.getInt("find { it.market == 'BE' }.version"))
        val envs = given().get("/api/environments").jsonPath()
        assertEquals(listOf("CONNECTED", "SIMULATED", "SIMULATED"), envs.getList<String>("mode"))
    }

    @Test
    fun `authoring refuses what a release couldn't carry`() {
        fun create(code: String, p: Map<String, Any?>) =
            given().contentType(ContentType.JSON).body(mapOf("market" to mapOf("code" to code), "profiles" to listOf(p))).post("/api/markets")
        create("AT", profile("CORPORATE") + ("dimensions" to mapOf("requiresBankConfirmation" to "Y"))).then().statusCode(400)
        create("AT", profile(extra = mapOf("timeZone" to "Mars/Olympus"))).then().statusCode(400)
        create("AT", profile(extra = mapOf("cancellationWindow" to "an hour"))).then().statusCode(400)
        create("AT", profile(extra = mapOf("ravenStatuses" to listOf("SHIPPED")))).then().statusCode(400)
        create(
            "AT",
            profile() + ("apis" to listOf("CreatePayment.v3", "MoneyMovementEventHandler.v1", "CreatePaymentIntent.v1")),
        ).then().statusCode(201)
        assertEquals(listOf("CreatePayment.v3", "CreateMoneyMovementEventHandler.v1"), market("AT").getList<String>("profiles[0].apis"))

        // The wizard's review shows what billpay-core would receive, before anything is saved.
        val preview = given().contentType(ContentType.JSON).body(profile("CORPORATE", extra = mapOf("allocationFetchBefore" to "PT2H")))
            .post("/api/release-preview").then().statusCode(200).extract().jsonPath()
        assertEquals("Y", preview.getString("behaviors.requiresArPosting.value"))
        assertEquals("PT2H", preview.getString("allocationFetchBefore"))
        assertEquals(null, preview.get<Any>("customDimensions"))
    }
}
