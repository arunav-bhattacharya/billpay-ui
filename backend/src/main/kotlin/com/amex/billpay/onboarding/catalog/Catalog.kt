package com.amex.billpay.onboarding.catalog

import com.amex.billpay.onboarding.model.AccountType

enum class ApiCategory { CORE, COMPOSITE, EVENT_HANDLER }

/**
 * One One-Data function (wiki, "Billpay API Gateway - One Data Functions").
 *
 * [title] is the plain-language headline; [name] is the versioned identifier, which a release lists under `apis`.
 * [method] is the HTTP verb for a function that fronts a Billpay API, INBOX for one whose work One-Data keeps in its
 * inbox for a dispatcher to pull, and EVENT for an event handler; [path] is the endpoint, the inbox or the source.
 */
data class ApiSpec(
    val name: String,
    val title: String,
    val category: ApiCategory,
    val method: String,
    val path: String,
    val summary: String,
    val description: String,
) {
    /** Deep link into the API Explorer, which keys its pages on [name] verbatim. */
    val specUrl: String
        get() = "https://explorer.aexp.com/functions/$name"
}

data class CuratedMarket(
    val code: String,
    val name: String,
    val currency: String,
    val region: String,
    /** Account types this market supports. Defaults to all three. */
    val allowedAccountTypes: List<AccountType> =
        listOf(AccountType.CONSUMER, AccountType.CORPORATE, AccountType.BUSINESS_TRAVEL_ACCOUNT),
)

data class BehaviorMeta(
    /** One of the persisted `requires*` keys, which are also the release's. */
    val key: String,
    val label: String,
    val description: String,
    /** Whether BOTH takes a list of journeys from the Operations step; the other two BOTH rules are the spec's own. */
    val bothRuleByJourney: Boolean = false,
    /** Account types the behavior applies to; any other is held at N. */
    val accountTypes: List<AccountType> = AccountType.entries,
)

data class AccountTypeMeta(
    val key: String,
    val label: String,
    val description: String,
)

/** One of billpay-core's journeys, for a BOTH rule's `yesForJourneys` (billpay-core `Journey`). */
data class JourneyMeta(val key: String, val label: String)

/** Static source of truth served to the UI via /api/catalog. */
object Catalog {

    val apis: List<ApiSpec> = listOf(
        // ---- Core ----
        ApiSpec(
            name = "CreatePayment.v3",
            title = "Create a payment",
            category = ApiCategory.CORE,
            method = "POST", path = "/payments",
            summary = "Pay today, or schedule a payment for a future date.",
            description = "The channels' entry point into Billpay. A payment that needs the customer to confirm at " +
                "their bank, or a debit card payment while 3D Secure runs, comes back PENDING with its link.",
        ),
        ApiSpec(
            name = "UpdatePayment.v1",
            title = "Update a payment",
            category = ApiCategory.CORE,
            method = "PUT", path = "/payments/{payment-id}",
            summary = "Change a scheduled payment inside the cancellation window.",
            description = "Replaces a SCHEDULED payment while the market's cancellation window is open; after it " +
                "closes the answer is 409. A corporate payment leaves SCHEDULED once its allocations are requested.",
        ),
        ApiSpec(
            name = "DeletePayment.v1",
            title = "Cancel a payment",
            category = ApiCategory.CORE,
            method = "DELETE", path = "/payments/{payment-id}",
            summary = "Cancel a scheduled payment, or one waiting for bank confirmation.",
            description = "Cancels a SCHEDULED payment inside the cancellation window, or a PENDING payment that " +
                "waits for a confirmation when the customer says no.",
        ),
        ApiSpec(
            name = "ReadPayments.v1",
            title = "Read payments for an account",
            category = ApiCategory.CORE,
            method = "GET", path = "/payments/account/{account-id}",
            summary = "List the payments on a card account.",
            description = "Lists every payment on a card account: the backbone of payment-activity and servicing " +
                "screens, and how an event without a payment ID is matched.",
        ),
        ApiSpec(
            name = "ReadPaymentEventsById.v1",
            title = "Read a payment and its events",
            category = ApiCategory.CORE,
            method = "GET", path = "/payments/{payment-id}",
            summary = "One payment and the states it has been through.",
            description = "Returns one payment and its lifecycle events, with its redirect or challenge link while " +
                "it waits for bank confirmation or 3D Secure.",
        ),
        ApiSpec(
            name = "CreateCreditBalanceRefund.v1",
            title = "Refund a credit balance",
            category = ApiCategory.CORE,
            method = "POST", path = "/refunds",
            summary = "Return a credit balance to the customer.",
            description = "Refunds a credit balance on a card account: the refund half of Billpay's payments and " +
                "refunds.",
        ),
        ApiSpec(
            name = "CreateInboundPayment.v1",
            title = "Take an inbound payment",
            category = ApiCategory.CORE,
            method = "INBOX", path = "One-Data inbox, inbound dispatcher",
            summary = "A payment pushed by a third party.",
            description = "One-Data stores the push payment in its inbox and replies 202; Billpay's inbound " +
                "dispatcher pulls it and starts its workflow.",
        ),
        ApiSpec(
            name = "CreatePaymentSubmission.v1",
            title = "Submit a payment after the bank",
            category = ApiCategory.CORE,
            method = "POST", path = "/payments/{payment-id}/submission",
            summary = "The customer is back from their bank; submit and get the status.",
            description = "Channels call it once the payer's bank routes the customer back. Billpay submits the " +
                "payment to Amex Pay with Bank Transfer and answers PENDING, ACCEPTED or DECLINED.",
        ),
        ApiSpec(
            name = "CreatePaymentAllocations.v1",
            title = "Take a corporate payment's allocations",
            category = ApiCategory.CORE,
            method = "POST", path = "/payments/{payment-id}/allocations",
            summary = "The allocations callback for corporate payments.",
            description = "Takes one batch of allocations for a corporate payment; 202 once the batch is stored and " +
                "its workflow has started. billpay-offline serves it.",
        ),
        ApiSpec(
            name = "ReadBillpayInstruments.v1",
            title = "Read the instruments a customer can pay from",
            category = ApiCategory.CORE,
            method = "GET", path = "/instruments/account/{account-id}",
            summary = "The instruments the page may offer, by source and journey context.",
            description = "Filters what the instruments systems return by the market's rules and, for enrolled " +
                "instruments, by the statuses the journey context allows. It starts no workflow.",
        ),

        // ---- Composite ----
        ApiSpec(
            name = "CreatePaymentInstallment.v1",
            title = "Create a payment and an installment plan",
            category = ApiCategory.COMPOSITE,
            method = "POST", path = "/payment-installments",
            summary = "Pay today and plan future installments (Pay & Plan).",
            description = "Pays today and creates a plan of future installments in one call. A profile that takes " +
                "it offers Pay & Plan.",
        ),
        ApiSpec(
            name = "CreateBillpayTransactionFromAccountsReceivable.v1",
            title = "Take payments and refunds from Accounts Receivable",
            category = ApiCategory.COMPOSITE,
            method = "INBOX", path = "One-Data inbox, AR intake dispatcher",
            summary = "Payments and refunds raised by the Accounts Receivable platform.",
            description = "One-Data stores each in its inbox and replies 202; Billpay's AR intake dispatcher pulls " +
                "them. Never a corporate payment.",
        ),

        // ---- Event Handlers ----
        ApiSpec(
            name = "CreateMoneyMovementEventHandler.v1",
            title = "Handle money-movement events",
            category = ApiCategory.EVENT_HANDLER,
            method = "EVENT", path = "MR/M3",
            summary = "Returns and settlements from the clearing rail.",
            description = "A return goes to One-Data's inbox for the returns dispatcher; a settlement is recorded " +
                "there against its payment and presentment.",
        ),
        ApiSpec(
            name = "CreateAccountsReceivableTransactionEventHandler.v1",
            title = "Handle Accounts Receivable postings",
            category = ApiCategory.EVENT_HANDLER,
            method = "EVENT", path = "GAR",
            summary = "AR posting events from GAR.",
            description = "An AR posting is recorded in One-Data's inbox against its payment, or leg, and " +
                "presentment; with its settlement it turns the payment PAID.",
        ),
        ApiSpec(
            name = "CreateOpentoBuyUpdatePaymentEventHandler.v1",
            title = "Handle Open-To-Buy updates",
            category = ApiCategory.EVENT_HANDLER,
            method = "EVENT", path = "AMP",
            summary = "Authorizations events, acknowledged only.",
            description = "Acknowledges Authorizations (AMP) events and does nothing else: no inbox row and no work " +
                "in Billpay.",
        ),
        ApiSpec(
            name = "CreateBillpaySettlementEvent.v1",
            title = "Handle a bank transfer's settlement",
            category = ApiCategory.EVENT_HANDLER,
            method = "EVENT", path = "M3, then POST /payments/{payment-id}/settlement",
            summary = "M3's notice that a Pay with Bank Transfer payment settled, or failed to.",
            description = "M3 calls it when the payer's bank settles in real time; it signals the waiting payment " +
                "through billpay-online. Its contract is a placeholder until the company's repo supplies it.",
        ),
        ApiSpec(
            name = "UpdatePaymentConfirmation.v1",
            title = "Handle a bank transfer's confirmation",
            category = ApiCategory.EVENT_HANDLER,
            method = "EVENT", path = "Amex Pay with Bank Transfer, then POST /payments/{payment-id}/confirmation",
            summary = "Amex Pay with Bank Transfer's own answer, confirmed or declined.",
            description = "Comes whether or not the channel called CreatePaymentSubmission.v1, so a payment whose " +
                "channel never calls is still decided. It writes nothing to the inbox.",
        ),
    )

    val apisByName: Map<String, ApiSpec> = apis.associateBy { it.name }

    /**
     * Names stored documents may still carry, and what they are now: the event handlers' names start with Create
     * (wiki). CreatePaymentIntent.v1 is gone, with no successor of its own; a profile that took it reads without it.
     */
    private val renamed: Map<String, String?> = mapOf(
        "MoneyMovementEventHandler.v1" to "CreateMoneyMovementEventHandler.v1",
        "AccountsReceivableTransactionEventHandler.v1" to "CreateAccountsReceivableTransactionEventHandler.v1",
        "OpentoBuyUpdatePaymentEventHandler.v1" to "CreateOpentoBuyUpdatePaymentEventHandler.v1",
        "CreatePaymentIntent.v1" to null,
    )

    /** A stored API list in today's names, in catalog order. */
    fun currentApiNames(stored: List<String>): List<String> {
        val names = stored.mapNotNull { if (it in renamed) renamed[it] else it }.toSet()
        return apis.map { it.name }.filter { it in names } + names.filter { it !in apisByName }
    }

    val markets: List<CuratedMarket> = listOf(
        CuratedMarket("US", "United States", "USD", "AMER"),
        CuratedMarket("CA", "Canada", "CAD", "AMER"),
        CuratedMarket("MX", "Mexico", "MXN", "AMER"),
        CuratedMarket("AR", "Argentina", "ARS", "AMER"),
        CuratedMarket("PR", "Puerto Rico", "USD", "AMER"),
        CuratedMarket("GB", "United Kingdom", "GBP", "EMEA"),
        CuratedMarket("DE", "Germany", "EUR", "EMEA"),
        CuratedMarket("FR", "France", "EUR", "EMEA"),
        CuratedMarket("IT", "Italy", "EUR", "EMEA"),
        CuratedMarket("ES", "Spain", "EUR", "EMEA"),
        CuratedMarket("NL", "Netherlands", "EUR", "EMEA"),
        CuratedMarket("BE", "Belgium", "EUR", "EMEA"),
        CuratedMarket("AT", "Austria", "EUR", "EMEA"),
        CuratedMarket("FI", "Finland", "EUR", "EMEA"),
        CuratedMarket("SE", "Sweden", "SEK", "EMEA"),
        CuratedMarket("NO", "Norway", "NOK", "EMEA"),
        CuratedMarket("DK", "Denmark", "DKK", "EMEA", listOf(AccountType.CORPORATE)),
        CuratedMarket("PL", "Poland", "PLN", "EMEA", listOf(AccountType.CORPORATE)),
        CuratedMarket("CZ", "Czechia", "CZK", "EMEA", listOf(AccountType.CORPORATE)),
        CuratedMarket("IN", "India", "INR", "APAC"),
        CuratedMarket("JP", "Japan", "JPY", "APAC"),
        CuratedMarket("AU", "Australia", "AUD", "APAC"),
        CuratedMarket("NZ", "New Zealand", "NZD", "APAC"),
        CuratedMarket("SG", "Singapore", "SGD", "APAC"),
        CuratedMarket("HK", "Hong Kong", "HKD", "APAC"),
        CuratedMarket("TW", "Taiwan", "TWD", "APAC"),
        CuratedMarket("TH", "Thailand", "THB", "APAC"),
    )

    val marketsByCode: Map<String, CuratedMarket> = markets.associateBy { it.code }

    val behaviors: List<BehaviorMeta> = listOf(
        BehaviorMeta(
            // Key stays requiresArPosting: it is persisted in every stored document and is the release's key.
            key = "requiresArPosting",
            label = "Good-faith Credit",
            description = "Billpay tells AR to post the payment while it is still processing, so the cardmember " +
                "gets credit before the money settles.",
            bothRuleByJourney = true,
        ),
        BehaviorMeta(
            key = "requiresRealtimeClearing",
            label = "Realtime Clearing",
            description = "Pay-today payments clear in real time; every future-dated payment clears in batch, and " +
                "for now so does every corporate payment.",
        ),
        BehaviorMeta(
            key = "requiresMandateAuthorization",
            label = "Mandate Authorization",
            description = "Verify, and Reverify on the due date, fetch the payment's mandate from Plans and check " +
                "it; a mandate that fails declines the payment.",
            bothRuleByJourney = true,
        ),
        BehaviorMeta(
            key = "requiresBankConfirmation",
            label = "Bank Confirmation",
            description = "The customer confirms the payment at their bank through Amex Pay with Bank Transfer " +
                "before it is processed. Pay today, one instruction only.",
            // Corporate payments never take it; business travel waits until it is turned on (spec, Proposed).
            accountTypes = listOf(AccountType.CONSUMER),
        ),
    )

    val accountTypes: List<AccountTypeMeta> = listOf(
        AccountTypeMeta("CONSUMER", "Consumer", "Personal card accounts — the highest-volume segment."),
        AccountTypeMeta("CORPORATE", "Corporate", "Corporate card programs — the primary split-payment scenario; shapes more of the processing than any other behavior."),
        // Key stays BUSINESS_TRAVEL_ACCOUNT: it is persisted in every stored document; a release sends BUSINESS_TRAVEL.
        AccountTypeMeta("BUSINESS_TRAVEL_ACCOUNT", "Business Travel", "Centrally billed accounts that settle a company's travel spend without a card per traveller."),
    )

    /** billpay-core's journeys, for the BOTH rules (its `Journey` enum, in its order). */
    val journeys: List<JourneyMeta> = listOf(
        JourneyMeta("CREATE_IMMEDIATE_PAYMENT", "Pay today"),
        JourneyMeta("CREATE_PAYMENT_WITH_MULTIPLE_INSTRUCTIONS", "Pay today, several instructions"),
        JourneyMeta("CREATE_SCHEDULED_PAYMENT", "Schedule a payment"),
        JourneyMeta("CREATE_PAYMENT_INTENT", "Pay today, waiting for the customer"),
        JourneyMeta("PAY_AND_PLAN", "Pay & Plan"),
        JourneyMeta("UPDATE_PAYMENT", "Update a payment"),
        JourneyMeta("CANCEL_PAYMENT", "Cancel a payment"),
        JourneyMeta("CREATE_BALANCE_REFUND", "Refund a credit balance"),
        JourneyMeta("EXECUTE_SCHEDULED_PAYMENT", "Execute on the due date"),
        JourneyMeta("EXECUTE_SPLIT_PAYMENT", "Execute a split's leg"),
        JourneyMeta("REQUEST_ALLOCATIONS", "Request allocations"),
        JourneyMeta("RECEIVE_ALLOCATIONS", "Receive allocations"),
        JourneyMeta("PROCESS_RETURNED_PAYMENT", "Process a return"),
        JourneyMeta("PROCESS_REPRESENTMENT", "Represent a return"),
        JourneyMeta("PROCESS_INBOUND_PAYMENT", "Process an inbound payment"),
    )

    /** The payment states a Raven message can follow (wiki, "Payment Lifecycle States"). */
    val paymentStatuses: List<String> = listOf(
        "PENDING", "SCHEDULED", "ACCEPTED", "ALLOCATING", "ALLOCATED", "PROCESSING", "PROCESSED", "PAID",
        "RETURNED", "REPRESENTING", "REPRESENTED", "DECLINED", "CANCELLED", "DISALLOWED",
    )

    /** The statuses that send a Raven message when a release sets none (agreed 2026-11-08). */
    val defaultRavenStatuses: List<String> = listOf("SCHEDULED", "DECLINED", "CANCELLED", "PROCESSED", "RETURNED")

    /** The journey contexts `enrolledInstrumentStatuses` is keyed by; a context left out offers ACTIVE alone. */
    val journeyContexts: List<String> = listOf("ONE_TIME_DIRECT_DEBIT", "RECURRING_DIRECT_DEBIT")

    // ---- the onboarding workflow's steps, as readiness shows them ----

    const val STEP_RFC = "RFC"

    /** MarketOnboardingWorkflow's steps in order (billpay-core `ReleaseStep`), with E3's RFC before the sign-off. */
    val workflowSteps: List<Triple<String, String, String>> = listOf(
        Triple("CHECK", "Check", "Against this build's capability manifest"),
        Triple("SAVE", "Save", "Saved as an inactive version"),
        Triple("TEST", "Test", "Payments from the release's mock accounts run on it"),
        Triple(STEP_RFC, "Request for Change", "ServiceNow authorises the production release"),
        Triple("WAIT", "Sign off", "Someone accepts the test payments in this environment"),
        Triple("ACTIVATE", "Activate", "The active version switches and its Schedules apply"),
    )
}
