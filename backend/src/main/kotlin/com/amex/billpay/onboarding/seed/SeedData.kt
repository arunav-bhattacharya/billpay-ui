package com.amex.billpay.onboarding.seed

import com.amex.billpay.onboarding.entity.MarketEntity
import com.amex.billpay.onboarding.model.AccountType
import com.amex.billpay.onboarding.model.BankConfirmationSettings
import com.amex.billpay.onboarding.model.Behavior
import com.amex.billpay.onboarding.model.BehaviorValue
import com.amex.billpay.onboarding.model.CardAuthenticationSettings
import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.MarketDocument
import com.amex.billpay.onboarding.model.MarketInfo
import com.amex.billpay.onboarding.model.MarketProfile
import com.amex.billpay.onboarding.model.OperationsSettings
import com.amex.billpay.onboarding.model.RepresentmentRules
import com.amex.billpay.onboarding.model.RuleSettings
import com.amex.billpay.onboarding.service.MarketService
import com.amex.billpay.onboarding.service.ReleaseService
import io.quarkus.logging.Log
import io.quarkus.runtime.StartupEvent
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.event.Observes
import jakarta.transaction.Transactional
import org.eclipse.microprofile.config.inject.ConfigProperty
import java.math.BigDecimal
import java.time.Duration
import java.time.Instant

/**
 * Demo markets for an empty database: US and GB live in e3, JP waiting for its e2 sign-off. Their releases are
 * simulated, since no real environment ran them; a market onboarded in the UI is what goes through the real e1.
 * `billpay.seed=false` starts empty.
 */
@ApplicationScoped
class SeedData(
    private val service: MarketService,
    private val releases: ReleaseService,
    @param:ConfigProperty(name = "billpay.seed", defaultValue = "true") private val enabled: Boolean,
) {

    @Transactional
    fun onStart(@Observes event: StartupEvent) {
        if (enabled && MarketEntity.count() == 0L) {
            Log.info("Empty database — seeding demo markets (US, GB, JP)")
            seedDemoMarkets()
        }
        // Markets stored before the revision history existed have no entries; give each the CREATED record.
        service.backfillRevisions()
    }

    private fun seedDemoMarkets() {
        val since = Instant.now().minus(Duration.ofDays(30))

        val us = service.create(
            MarketDocument(
                market = MarketInfo(code = "US"),
                profiles = listOf(
                    MarketProfile(
                        accountType = AccountType.CONSUMER,
                        apis = listOf(
                            "CreatePayment.v3", "UpdatePayment.v1", "DeletePayment.v1",
                            "ReadPayments.v1", "ReadPaymentEventsById.v1", "CreateCreditBalanceRefund.v1",
                            "ReadBillpayInstruments.v1",
                            "CreateBillpayTransactionFromAccountsReceivable.v1",
                            "CreateMoneyMovementEventHandler.v1",
                            "CreateAccountsReceivableTransactionEventHandler.v1",
                        ),
                        dimensions = Behavior(requiresArPosting = BehaviorValue.Y),
                        operations = OperationsSettings(
                            timeZone = "America/New_York",
                            executionTime = "00:00",
                            cancellationWindow = "PT1H",
                            executionFloorTps = BigDecimal(50),
                            representment = RepresentmentRules(listOf("R01", "R09"), maxRepresentments = 1, delayDays = 2),
                            testAccounts = listOf("mock-us-consumer-01"),
                            ruleSettings = RuleSettings("25000 USD", listOf("BANK_ACCOUNT")),
                        ),
                    ),
                    MarketProfile(
                        accountType = AccountType.CORPORATE,
                        apis = listOf(
                            "CreatePayment.v3", "UpdatePayment.v1", "DeletePayment.v1",
                            "ReadPayments.v1", "ReadPaymentEventsById.v1",
                            "CreatePaymentAllocations.v1", "CreatePaymentInstallment.v1",
                            "CreateMoneyMovementEventHandler.v1",
                            "CreateAccountsReceivableTransactionEventHandler.v1",
                        ),
                        dimensions = Behavior(requiresArPosting = BehaviorValue.Y, requiresMandateAuthorization = BehaviorValue.Y),
                        operations = OperationsSettings(
                            timeZone = "America/New_York",
                            executionTime = "00:00",
                            cancellationWindow = "PT1H",
                            executionFloorTps = BigDecimal(50),
                            allocationFetchBefore = "PT0S",
                            allocationAlertAfter = "PT6H",
                            testAccounts = listOf("mock-us-corporate-01"),
                        ),
                    ),
                ),
            ),
            actor = "SYSTEM",
        )
        us.profiles.forEach { releases.seed("US", it.id, liveThrough = EnvStage.E3, at = since) }

        val gb = service.create(
            MarketDocument(
                market = MarketInfo(code = "GB"),
                profiles = listOf(
                    MarketProfile(
                        accountType = AccountType.CONSUMER,
                        apis = listOf(
                            "CreatePayment.v3", "UpdatePayment.v1", "DeletePayment.v1",
                            "ReadPayments.v1", "ReadPaymentEventsById.v1", "CreateCreditBalanceRefund.v1",
                            "CreatePaymentSubmission.v1", "ReadBillpayInstruments.v1",
                            "CreateMoneyMovementEventHandler.v1", "CreateBillpaySettlementEvent.v1",
                            "UpdatePaymentConfirmation.v1",
                        ),
                        dimensions = Behavior(
                            requiresRealtimeClearing = BehaviorValue.Y,
                            requiresBankConfirmation = BehaviorValue.BOTH,
                        ),
                        operations = OperationsSettings(
                            timeZone = "Europe/London",
                            executionTime = "01:00",
                            cancellationWindow = "PT1H",
                            bankConfirmation = BankConfirmationSettings(confirmationWindow = "PT24H"),
                            cardAuthentication = CardAuthenticationSettings("Checkout.com", "PT2M"),
                            testAccounts = listOf("mock-gb-consumer-01"),
                            ruleSettings = RuleSettings("25000 GBP", listOf("BANK_ACCOUNT")),
                        ),
                    ),
                ),
            ),
            actor = "SYSTEM",
        )
        gb.profiles.forEach { releases.seed("GB", it.id, liveThrough = EnvStage.E3, at = since.plus(Duration.ofDays(4))) }

        val jp = service.create(
            MarketDocument(
                market = MarketInfo(code = "JP"),
                profiles = listOf(
                    MarketProfile(
                        accountType = AccountType.CONSUMER,
                        apis = listOf("CreatePayment.v3", "ReadPayments.v1", "ReadPaymentEventsById.v1"),
                        dimensions = Behavior(),
                        operations = OperationsSettings(timeZone = "Asia/Tokyo", executionTime = "00:30"),
                    ),
                ),
            ),
            actor = "SYSTEM",
        )
        jp.profiles.forEach {
            releases.seed("JP", it.id, liveThrough = EnvStage.E1, waitingIn = EnvStage.E2, at = since.plus(Duration.ofDays(9)))
        }
    }
}
