package com.amex.billpay.onboarding.rest

import jakarta.ws.rs.WebApplicationException
import jakarta.ws.rs.core.MediaType
import jakarta.ws.rs.core.Response
import jakarta.ws.rs.ext.ExceptionMapper
import jakarta.ws.rs.ext.Provider

/** Surface WebApplicationException messages to the UI as JSON bodies. */
@Provider
class ErrorMapper : ExceptionMapper<WebApplicationException> {
    override fun toResponse(exception: WebApplicationException): Response =
        Response.status(exception.response.status)
            .type(MediaType.APPLICATION_JSON)
            .entity(mapOf("error" to (exception.message ?: "Request failed")))
            .build()
}
