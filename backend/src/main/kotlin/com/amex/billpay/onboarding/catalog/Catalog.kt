package com.amex.billpay.onboarding.catalog

import com.amex.billpay.onboarding.model.AccountType

enum class ApiCategory { CORE, COMPOSITE, EVENT_HANDLER }

/**
 * One-Data API specification.
 *
 * [title] is the plain-language headline; [name] is the versioned identifier.
 * [suggests] lists the behavior flags this API typically calls for — shown as
 * guidance in the UI; behavior is always selected manually. Its values are the
 * persisted `requires*` keys, which kept their names through the rename.
 */
data class ApiSpec(
    val name: String,
    val title: String,
    val category: ApiCategory,
    val method: String,
    val path: String,
    val summary: String,
    val description: String,
    val suggests: List<String> = emptyList(),
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
    /** One of the persisted `requires*` keys — see [ApiSpec.suggests]. */
    val key: String,
    val label: String,
    val description: String,
    /** False for behaviors that are strictly Y/N — the UI renders a 2-way control. */
    val allowsBoth: Boolean = true,
)

data class AccountTypeMeta(
    val key: String,
    val label: String,
    val description: String,
)

/** Static source of truth served to the UI via /api/catalog. */
object Catalog {

    val apis: List<ApiSpec> = listOf(
        // ---- Core ----
        ApiSpec(
            name = "CreatePayment.v3",
            title = "Create a payment",
            category = ApiCategory.CORE,
            method = "POST", path = "/payments",
            summary = "Initiate a payment — immediately, or scheduled for a future date.",
            description = "The primary entry point into Billpay. Creates a payment that either executes " +
                "immediately or is scheduled for a future date. Every market onboards this API.",
        ),
        ApiSpec(
            name = "UpdatePayment.v1",
            title = "Update a payment",
            category = ApiCategory.CORE,
            method = "PUT", path = "/payments/{payment-id}",
            summary = "Modify a scheduled payment.",
            description = "Modifies a scheduled payment through internal cancel-and-recreate logic, " +
                "preserving the payment identifier presented to the customer.",
        ),
        ApiSpec(
            name = "DeletePayment.v1",
            title = "Delete a payment",
            category = ApiCategory.CORE,
            method = "DELETE", path = "/payments/{payment-id}",
            summary = "Terminate a scheduled or accepted payment.",
            description = "Terminates a scheduled or accepted payment before it clears. Used by customer " +
                "servicing and self-service cancellation flows.",
        ),
        ApiSpec(
            name = "ReadPayments.v1",
            title = "Read payments for an account",
            category = ApiCategory.CORE,
            method = "GET", path = "/payments/account/{account-id}",
            summary = "Retrieve all payments for an account.",
            description = "Retrieves every payment associated with a specific account — the backbone of " +
                "payment-activity views and servicing screens.",
        ),
        ApiSpec(
            name = "ReadPaymentEventsById.v1",
            title = "Read a payment and its events",
            category = ApiCategory.CORE,
            method = "GET", path = "/payments/{payment-id}",
            summary = "Fetch a payment with its full lifecycle events.",
            description = "Fetches payment details along with the complete, ordered list of lifecycle " +
                "events — creation, acceptance, clearing, returns.",
        ),
        ApiSpec(
            name = "CreateCreditBalanceRefund.v1",
            title = "Create a credit-balance refund",
            category = ApiCategory.CORE,
            method = "POST", path = "/refunds",
            summary = "Return funds to the customer from a credit balance.",
            description = "Returns funds to a customer when their account carries a credit balance — " +
                "the refund half of Billpay's payments-and-refunds mandate.",
        ),
        ApiSpec(
            name = "CreateInboundPayment.v1",
            title = "Create an inbound payment",
            category = ApiCategory.CORE,
            method = "POST", path = "/payments/inbound",
            summary = "Record a payment initiated or confirmed by a third party.",
            description = "Records a payment that was initiated or confirmed outside Billpay (e.g. a " +
                "partner bank or wallet) so it participates in the normal payment lifecycle.",
        ),
        ApiSpec(
            name = "CreatePaymentIntent.v1",
            title = "Create a payment intent",
            category = ApiCategory.CORE,
            method = "POST", path = "/payments/intent",
            summary = "Register an intent that becomes a payment on bank confirmation.",
            description = "Registers a payment intent that converts to a payment once the customer's bank " +
                "confirms in realtime. Markets selecting it typically clear in realtime.",
            suggests = listOf("requiresRealtimeClearing"),
        ),

        // ---- Composite ----
        ApiSpec(
            name = "CreatePaymentInstallment.v1",
            title = "Create a payment installment plan",
            category = ApiCategory.COMPOSITE,
            method = "POST", path = "/payment-installments",
            summary = "A payment plus a future installment plan in one call.",
            description = "Creates a payment together with a future installment plan in a single call. " +
                "Standing installment authorizations must be verified, so it typically calls for " +
                "mandate authorization.",
            suggests = listOf("requiresMandateAuthorization"),
        ),
        ApiSpec(
            name = "CreateBillpayTransactionFromAccountsReceivable.v1",
            title = "Create a payment from Accounts Receivable",
            category = ApiCategory.COMPOSITE,
            method = "POST", path = "/payments",
            summary = "Payment originated by the Accounts Receivable platform.",
            description = "Accepts future-dated payments originated by the Accounts Receivable platform. " +
                "AR is the system of record for these, so AR posting is the usual companion.",
            suggests = listOf("requiresArPosting"),
        ),

        // ---- Event Handlers ----
        ApiSpec(
            name = "MoneyMovementEventHandler.v1",
            title = "Handle money-movement events",
            category = ApiCategory.EVENT_HANDLER,
            method = "EVENT", path = "clearing rail (MR/M3)",
            summary = "Brings in money-movement events from the clearing rail — returns and settlement.",
            description = "Consumes money-movement events (returns, settlement) from the MR/M3 clearing " +
                "rail. Required when the market clears payments in realtime.",
            suggests = listOf("requiresRealtimeClearing"),
        ),
        ApiSpec(
            name = "AccountsReceivableTransactionEventHandler.v1",
            title = "Handle Accounts Receivable posting events",
            category = ApiCategory.EVENT_HANDLER,
            method = "EVENT", path = "GAR platform",
            summary = "Consume posting events from the Accounts Receivable (GAR) system.",
            description = "Consumes posting confirmations from the GAR Accounts Receivable system so " +
                "Billpay can track cardmember debt updates. Markets consuming it typically post to AR.",
            suggests = listOf("requiresArPosting"),
        ),
        ApiSpec(
            name = "OpentoBuyUpdatePaymentEventHandler.v1",
            title = "Handle Open-To-Buy update events",
            category = ApiCategory.EVENT_HANDLER,
            method = "EVENT", path = "AMP platform",
            summary = "Process Open-To-Buy (AMP) update events.",
            description = "Processes Open-To-Buy update events from the AMP platform so available credit " +
                "reflects in-flight payments. Definition pending final AMP contract.",
        ),
    )

    val apisByName: Map<String, ApiSpec> = apis.associateBy { it.name }

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
            // Key stays requiresArPosting: it is persisted in every stored
            // document, and only the display label changed.
            key = "requiresArPosting",
            label = "Good-faith Credit",
            description = "Payments need to be reported to Accounts Receivable",
        ),
        BehaviorMeta(
            key = "requiresRealtimeClearing",
            label = "Realtime Clearing",
            description = "Payments clear the customer's bank in realtime rather than through " +
                "periodic batches.",
        ),
        BehaviorMeta(
            key = "requiresMandateAuthorization",
            label = "Mandate Authorization",
            description = "Standing payment authorizations require verification during processing.",
        ),
        BehaviorMeta(
            key = "requiresRepresentableReturn",
            label = "Representable Return",
            description = "A returned payment may be re-presented to the customer's bank for clearing.",
            allowsBoth = false,
        ),
    )

    val accountTypes: List<AccountTypeMeta> = listOf(
        AccountTypeMeta("CONSUMER", "Consumer", "Personal card accounts — the highest-volume segment."),
        AccountTypeMeta("CORPORATE", "Corporate", "Corporate card programs — the primary split-payment scenario; shapes more of the processing than any other behavior."),
        // Key stays BUSINESS_TRAVEL_ACCOUNT: it is persisted in every stored
        // document, and only the display label was shortened.
        AccountTypeMeta("BUSINESS_TRAVEL_ACCOUNT", "Business Travel", "Centrally billed accounts that settle a company's travel spend without a card per traveller."),
    )

    // ---- environment readiness ----

    const val STEP_MARKET_PROFILE = "MARKET_PROFILE"
    const val STEP_TEST_PROFILE = "TEST_PROFILE"
    const val STEP_VERIFY_PROFILES = "VERIFY_PROFILES"
    const val STEP_RFC = "RFC"
    const val STEP_SIGN_OFF = "SIGN_OFF"

    /**
     * The last step in every environment, and the only one a person closes by
     * hand. Deliberately separate from verification: the checks passing is not
     * the same as somebody accepting the result.
     */
    val signOffStep: Triple<String, String, String> = Triple(
        STEP_SIGN_OFF,
        "Sign off",
        "Accepts this environment and releases the profile for promotion",
    )

    /**
     * Production takes one step the environments below it do not: a ServiceNow
     * change request has to authorise the release before anything is put in.
     * It runs first, so the market profile waits on it.
     */
    val rfcStep: Triple<String, String, String> = Triple(
        STEP_RFC,
        "Request for Change",
        "Validates the ServiceNow change request authorising this release",
    )

    /**
     * The steps that take a profile from nothing to onboarded in one
     * environment, in order. The last one fans out over the profile's own APIs,
     * so it is the only step whose size varies by market.
     */
    val readinessSteps: List<Triple<String, String, String>> = listOf(
        Triple(
            STEP_MARKET_PROFILE,
            "Market profile",
            "Sets up the market's API and behavior configuration",
        ),
        Triple(
            STEP_TEST_PROFILE,
            "Test profile",
            "Builds the set of tests the new market has to pass",
        ),
        Triple(
            STEP_VERIFY_PROFILES,
            "Verify profile",
            "Runs every onboarded API against the test profile",
        ),
    )

    /** Environment display names used alongside the e1/e2/e3 short forms. */
    val environmentNames: Map<String, String> = mapOf(
        "E1" to "Development",
        "E2" to "Testing",
        "E3" to "Production",
    )
}
