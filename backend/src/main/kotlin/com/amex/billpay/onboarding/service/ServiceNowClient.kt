package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.model.RfcValidation
import jakarta.enterprise.context.ApplicationScoped

/**
 * Looks a change request up in ServiceNow.
 *
 * Stubbed: nothing is wired to a ServiceNow instance yet, so every number the
 * caller supplies comes back approved. The seam is the point — replacing this
 * body with the REST call changes nothing above it, and callers already handle
 * a `valid = false` answer.
 */
@ApplicationScoped
class ServiceNowClient {

    fun validate(rfcNumber: String): RfcValidation =
        RfcValidation(
            rfcNumber = rfcNumber,
            valid = true,
            message = "Change request $rfcNumber is approved for release.",
        )
}
