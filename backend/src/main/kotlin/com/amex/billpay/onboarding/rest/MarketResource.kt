package com.amex.billpay.onboarding.rest

import com.amex.billpay.onboarding.model.ActivateRequest
import com.amex.billpay.onboarding.model.CloneRequest
import com.amex.billpay.onboarding.model.MarketDocument
import com.amex.billpay.onboarding.service.MarketService
import jakarta.ws.rs.Consumes
import jakarta.ws.rs.DELETE
import jakarta.ws.rs.GET
import jakarta.ws.rs.POST
import jakarta.ws.rs.PUT
import jakarta.ws.rs.Path
import jakarta.ws.rs.PathParam
import jakarta.ws.rs.Produces
import jakarta.ws.rs.core.MediaType
import jakarta.ws.rs.core.Response

@Path("/api/markets")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
class MarketResource(private val service: MarketService) {

    @GET
    fun list(): List<MarketDocument> = service.listAll()

    @GET
    @Path("/{code}")
    fun get(@PathParam("code") code: String): MarketDocument = service.getByCode(code)

    @POST
    fun create(document: MarketDocument): Response =
        Response.status(Response.Status.CREATED).entity(service.create(document)).build()

    @PUT
    @Path("/{code}")
    fun update(@PathParam("code") code: String, document: MarketDocument): MarketDocument =
        service.update(code, document)

    @DELETE
    @Path("/{code}")
    fun delete(@PathParam("code") code: String): Response {
        service.delete(code)
        return Response.noContent().build()
    }

    @POST
    @Path("/{code}/activate")
    fun activate(@PathParam("code") code: String, request: ActivateRequest?): MarketDocument =
        service.activate(code, request?.profileId)

    @POST
    @Path("/{code}/clone")
    fun clone(@PathParam("code") code: String, request: CloneRequest): Response =
        Response.status(Response.Status.CREATED).entity(service.clone(code, request.targetCode)).build()
}
