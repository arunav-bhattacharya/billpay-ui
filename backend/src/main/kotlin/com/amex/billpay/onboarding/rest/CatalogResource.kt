package com.amex.billpay.onboarding.rest

import com.amex.billpay.onboarding.catalog.Catalog
import jakarta.ws.rs.GET
import jakarta.ws.rs.Path
import jakarta.ws.rs.Produces
import jakarta.ws.rs.core.MediaType

@Path("/api/catalog")
@Produces(MediaType.APPLICATION_JSON)
class CatalogResource {

    @GET
    fun catalog(): Map<String, Any> = mapOf(
        "apis" to Catalog.apis,
        "markets" to Catalog.markets,
        // Response key predates the behavior rename; the UI still reads `dimensions`.
        "dimensions" to Catalog.behaviors,
        "accountTypes" to Catalog.accountTypes,
        "environmentNames" to Catalog.environmentNames,
    )
}
