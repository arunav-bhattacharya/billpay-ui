package com.amex.billpay.onboarding.rest

import com.amex.billpay.onboarding.model.CloneRequest
import com.amex.billpay.onboarding.model.MarketDocument
import com.amex.billpay.onboarding.model.MarketRevision
import com.amex.billpay.onboarding.model.RfcRequest
import com.amex.billpay.onboarding.service.MarketService
import jakarta.ws.rs.Consumes
import jakarta.ws.rs.DELETE
import jakarta.ws.rs.DefaultValue
import jakarta.ws.rs.GET
import jakarta.ws.rs.HeaderParam
import jakarta.ws.rs.POST
import jakarta.ws.rs.PUT
import jakarta.ws.rs.Path
import jakarta.ws.rs.PathParam
import jakarta.ws.rs.Produces
import jakarta.ws.rs.core.MediaType
import jakarta.ws.rs.core.Response

/**
 * `X-Billpay-Role` names who is acting, for the revision history. The app has
 * no authentication — this is the UI's role toggle, not an identity claim, and
 * it defaults to OPERATOR when absent.
 */
private const val ROLE_HEADER = "X-Billpay-Role"

@Path("/api/markets")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
class MarketResource(private val service: MarketService) {

    @GET
    fun list(): List<MarketDocument> = service.listAll()

    @GET
    @Path("/{code}")
    fun get(@PathParam("code") code: String): MarketDocument = service.getByCode(code)

    @GET
    @Path("/{code}/revisions")
    fun revisions(@PathParam("code") code: String): List<MarketRevision> = service.revisions(code)

    @POST
    fun create(
        document: MarketDocument,
        @HeaderParam(ROLE_HEADER) @DefaultValue("OPERATOR") actor: String,
    ): Response =
        Response.status(Response.Status.CREATED).entity(service.create(document, actor)).build()

    @PUT
    @Path("/{code}")
    fun update(
        @PathParam("code") code: String,
        document: MarketDocument,
        @HeaderParam(ROLE_HEADER) @DefaultValue("OPERATOR") actor: String,
    ): MarketDocument = service.update(code, document, actor)

    @DELETE
    @Path("/{code}")
    fun delete(@PathParam("code") code: String): Response {
        service.delete(code)
        return Response.noContent().build()
    }

    @POST
    @Path("/{code}/profiles/{profileId}/promote")
    fun promoteProfile(
        @PathParam("code") code: String,
        @PathParam("profileId") profileId: String,
        @HeaderParam(ROLE_HEADER) @DefaultValue("OPERATOR") actor: String,
    ): MarketDocument = service.promote(code, profileId, actor)

    @POST
    @Path("/{code}/profiles/{profileId}/verify")
    fun verifyProfile(
        @PathParam("code") code: String,
        @PathParam("profileId") profileId: String,
        @HeaderParam(ROLE_HEADER) @DefaultValue("OPERATOR") actor: String,
    ): MarketDocument = service.verifyProfile(code, profileId, actor)

    @POST
    @Path("/{code}/profiles/{profileId}/rfc")
    fun recordRfc(
        @PathParam("code") code: String,
        @PathParam("profileId") profileId: String,
        request: RfcRequest,
        @HeaderParam(ROLE_HEADER) @DefaultValue("OPERATOR") actor: String,
    ): MarketDocument = service.recordRfc(code, profileId, request.rfcNumber, actor)

    @DELETE
    @Path("/{code}/profiles/{profileId}")
    fun deleteProfile(
        @PathParam("code") code: String,
        @PathParam("profileId") profileId: String,
        @HeaderParam(ROLE_HEADER) @DefaultValue("OPERATOR") actor: String,
    ): MarketDocument = service.deleteProfile(code, profileId, actor)

    @POST
    @Path("/{code}/clone")
    fun clone(
        @PathParam("code") code: String,
        request: CloneRequest,
        @HeaderParam(ROLE_HEADER) @DefaultValue("OPERATOR") actor: String,
    ): Response =
        Response.status(Response.Status.CREATED)
            .entity(service.clone(code, request.targetCode, request.accountTypes, actor))
            .build()
}
