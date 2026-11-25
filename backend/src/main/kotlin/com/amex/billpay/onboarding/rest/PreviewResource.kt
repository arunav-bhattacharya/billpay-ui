package com.amex.billpay.onboarding.rest

import com.amex.billpay.onboarding.model.MarketProfile
import com.amex.billpay.onboarding.service.ReleaseJson
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.ws.rs.Consumes
import jakarta.ws.rs.POST
import jakarta.ws.rs.Path
import jakarta.ws.rs.Produces
import jakarta.ws.rs.core.MediaType

/**
 * The release JSON a profile would freeze as, before it is saved: what billpay-core's Router would read. The wizard's
 * review shows it, so an operator sees what e1 receives rather than billpay-ui's own document.
 */
@Path("/api/release-preview")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
class PreviewResource(private val mapper: ObjectMapper) {

    @POST
    fun preview(profile: MarketProfile): Any = ReleaseJson.build(profile, mapper)
}
