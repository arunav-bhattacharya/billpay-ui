package com.amex.billpay.onboarding

import com.amex.billpay.onboarding.model.AccountType
import com.amex.billpay.onboarding.model.BankConfirmationSettings
import com.amex.billpay.onboarding.model.Behavior
import com.amex.billpay.onboarding.model.BehaviorValue
import com.amex.billpay.onboarding.model.DeploymentView
import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.MarketProfile
import com.amex.billpay.onboarding.model.OperationsSettings
import com.amex.billpay.onboarding.model.ReleaseStatus
import com.amex.billpay.onboarding.model.ReleaseStep
import com.amex.billpay.onboarding.model.StepState
import com.amex.billpay.onboarding.service.Readiness
import com.amex.billpay.onboarding.service.ReleaseJson
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

/** The release JSON billpay-core's Router reads, and the readiness steps read back from a deployment. */
class ReleaseJsonTest {
    private val mapper = jacksonObjectMapper()

    private fun profile(type: AccountType, behavior: Behavior, ops: OperationsSettings) =
        MarketProfile(accountType = type, apis = listOf("UpdatePayment.v1", "CreatePayment.v3"), dimensions = behavior, operations = ops)

    @Test
    fun `a BOTH rule lists its journeys, and only a release it applies to carries a key`() {
        val ops = OperationsSettings(
            allocationFetchBefore = "PT2H",
            bankConfirmation = BankConfirmationSettings(confirmationWindow = "PT24H"),
            bothRules = mapOf("requiresArPosting" to listOf("CREATE_SCHEDULED_PAYMENT", "CREATE_IMMEDIATE_PAYMENT")),
        )
        val corporate = ReleaseJson.build(profile(AccountType.CORPORATE, Behavior(requiresArPosting = BehaviorValue.BOTH), ops), mapper)
        assertEquals(listOf("CreatePayment.v3", "UpdatePayment.v1"), corporate["apis"].map { it.asText() })
        assertEquals(
            listOf("CREATE_IMMEDIATE_PAYMENT", "CREATE_SCHEDULED_PAYMENT"),
            corporate["behaviors"]["requiresArPosting"]["yesForJourneys"].map { it.asText() },
        )
        assertEquals("PT2H", corporate["allocationFetchBefore"].asText())
        assertFalse(corporate.has("bankConfirmation"), "bank confirmation N sends no block")

        val consumer = ReleaseJson.build(
            profile(AccountType.CONSUMER, Behavior(requiresBankConfirmation = BehaviorValue.Y, requiresRealtimeClearing = BehaviorValue.BOTH), ops),
            mapper,
        )
        assertFalse(consumer.has("allocationFetchBefore"))
        assertEquals("PT24H", consumer["bankConfirmation"]["confirmationWindow"].asText())
        assertFalse(consumer["behaviors"]["requiresRealtimeClearing"].has("yesForJourneys"), "clearing's BOTH rule is the spec's own")
        assertFalse(consumer.has("timeZone"), "an unset key is left out, so billpay-core's default applies")
    }

    @Test
    fun `the checksum follows the content, not the order it was written in`() {
        val a = OperationsSettings(enrolledInstrumentStatuses = linkedMapOf("ONE_TIME_DIRECT_DEBIT" to listOf("ACTIVE"), "RECURRING_DIRECT_DEBIT" to listOf("ACTIVE")))
        val b = OperationsSettings(enrolledInstrumentStatuses = linkedMapOf("RECURRING_DIRECT_DEBIT" to listOf("ACTIVE"), "ONE_TIME_DIRECT_DEBIT" to listOf("ACTIVE")))
        fun sum(o: OperationsSettings) = ReleaseJson.checksum(mapper.writeValueAsString(ReleaseJson.build(profile(AccountType.CONSUMER, Behavior(), o), mapper)))
        assertEquals(sum(a), sum(b))
        assertTrue(sum(a) != sum(OperationsSettings(executionTime = "01:00")))
    }

    private fun deployment(status: ReleaseStatus, step: ReleaseStep?, rfc: String? = null) = DeploymentView(
        version = 1, env = EnvStage.E3, workflowId = null, status = status, step = step, reason = null, needsBuild = false,
        replacedVersion = null, simulated = false, requestedBy = null, requestedAt = Instant.EPOCH, updatedAt = Instant.EPOCH,
        signedOffBy = null, signedOffAt = null, rfc = rfc, lastError = null,
    )

    @Test
    fun `readiness follows the workflow's step, with e3's RFC ahead of its sign-off`() {
        val waiting = Readiness.steps(EnvStage.E3, deployment(ReleaseStatus.WAITING_FOR_SIGN_OFF, ReleaseStep.WAIT))
        assertEquals(listOf("CHECK", "SAVE", "TEST", "RFC", "WAIT", "ACTIVATE"), waiting.map { it.key })
        assertEquals(
            listOf(StepState.COMPLETE, StepState.COMPLETE, StepState.COMPLETE, StepState.IN_PROGRESS, StepState.IN_PROGRESS, StepState.PENDING),
            waiting.map { it.state },
        )
        val withRfc = Readiness.steps(EnvStage.E3, deployment(ReleaseStatus.WAITING_FOR_SIGN_OFF, ReleaseStep.WAIT, rfc = "CHG1"))
        assertEquals(StepState.COMPLETE, withRfc.first { it.key == "RFC" }.state)

        val failed = Readiness.steps(EnvStage.E1, deployment(ReleaseStatus.FAILED, ReleaseStep.CHECK))
        assertEquals(listOf(StepState.FAILED, StepState.PENDING, StepState.PENDING, StepState.PENDING, StepState.PENDING), failed.map { it.state })
        assertTrue(Readiness.steps(EnvStage.E1, deployment(ReleaseStatus.ACTIVE, null)).all { it.state == StepState.COMPLETE })
    }
}
