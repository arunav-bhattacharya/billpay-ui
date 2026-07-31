package com.amex.billpay.onboarding.seed

import com.amex.billpay.onboarding.entity.MarketEntity
import com.amex.billpay.onboarding.model.AccountType
import com.amex.billpay.onboarding.model.CustomDimensionDef
import com.amex.billpay.onboarding.model.CustomDimensionType
import com.amex.billpay.onboarding.model.DimValue
import com.amex.billpay.onboarding.model.Dimensions
import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.MarketDocument
import com.amex.billpay.onboarding.model.MarketInfo
import com.amex.billpay.onboarding.model.MarketProfile
import com.amex.billpay.onboarding.service.MarketService
import io.quarkus.logging.Log
import io.quarkus.runtime.StartupEvent
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.event.Observes
import jakarta.transaction.Transactional

@ApplicationScoped
class SeedData(private val service: MarketService) {

    @Transactional
    fun onStart(@Observes event: StartupEvent) {
        if (MarketEntity.count() > 0) return
        Log.info("Empty database — seeding demo markets (US, GB, JP)")

        service.create(
            MarketDocument(
                market = MarketInfo(code = "US"),
                customDimensionDefs = listOf(
                    CustomDimensionDef(
                        key = "settlementWindow",
                        label = "Settlement Window",
                        type = CustomDimensionType.ENUM,
                        allowedValues = listOf("T+0", "T+1", "T+2"),
                        description = "How quickly cleared funds settle to the AR ledger.",
                    ),
                ),
                profiles = listOf(
                    MarketProfile(
                        accountType = AccountType.CONSUMER,
                        status = EnvStage.E3,
                        apis = listOf(
                            "CreatePayment.v3", "UpdatePayment.v1", "DeletePayment.v1",
                            "ReadPayments.v1", "ReadPaymentEventsById.v1", "CreateCreditBalanceRefund.v1",
                            "CreateBillpayTransactionFromAccountsReceivable.v1",
                            "AccountsReceivableTransactionEventHandler.v1",
                        ),
                        dimensions = Dimensions(requiresArPosting = DimValue.Y),
                        customDimensions = mapOf("settlementWindow" to "T+1"),
                    ),
                    MarketProfile(
                        accountType = AccountType.CORPORATE,
                        status = EnvStage.E3,
                        apis = listOf(
                            "CreatePayment.v3", "UpdatePayment.v1", "DeletePayment.v1",
                            "ReadPayments.v1", "ReadPaymentEventsById.v1",
                            "CreatePaymentInstallment.v1",
                            "CreateBillpayTransactionFromAccountsReceivable.v1",
                            "AccountsReceivableTransactionEventHandler.v1",
                        ),
                        dimensions = Dimensions(requiresArPosting = DimValue.Y, requiresMandateAuthorization = DimValue.Y),
                        customDimensions = mapOf("settlementWindow" to "T+0"),
                    ),
                ),
            )
        )

        service.create(
            MarketDocument(
                market = MarketInfo(code = "GB"),
                profiles = listOf(
                    MarketProfile(
                        accountType = AccountType.CONSUMER,
                        status = EnvStage.E3,
                        apis = listOf(
                            "CreatePayment.v3", "UpdatePayment.v1", "DeletePayment.v1",
                            "ReadPayments.v1", "ReadPaymentEventsById.v1", "CreateCreditBalanceRefund.v1",
                            "CreatePaymentIntent.v1", "MoneyMovementEventHandler.v1",
                        ),
                        dimensions = Dimensions(requiresRealtimeClearing = DimValue.Y),
                    ),
                ),
            )
        )

        service.create(
            MarketDocument(
                market = MarketInfo(code = "JP"),
                profiles = listOf(
                    MarketProfile(
                        accountType = AccountType.CONSUMER,
                        status = EnvStage.E2,
                        apis = listOf(
                            "CreatePayment.v3", "ReadPayments.v1", "ReadPaymentEventsById.v1",
                        ),
                        dimensions = Dimensions(),
                    ),
                ),
            )
        )
    }
}
