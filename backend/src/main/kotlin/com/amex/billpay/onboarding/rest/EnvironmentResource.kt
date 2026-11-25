package com.amex.billpay.onboarding.rest

import com.amex.billpay.onboarding.model.EnvironmentInfo
import com.amex.billpay.onboarding.model.LiveRelease
import com.amex.billpay.onboarding.service.Capabilities
import com.amex.billpay.onboarding.service.Environments
import com.amex.billpay.onboarding.service.ReleaseService
import jakarta.ws.rs.GET
import jakarta.ws.rs.Path
import jakarta.ws.rs.PathParam
import jakarta.ws.rs.Produces
import jakarta.ws.rs.core.MediaType

/** The environments a release moves through, and each one's deployed build's capability manifest. */
@Path("/api/environments")
@Produces(MediaType.APPLICATION_JSON)
class EnvironmentResource(private val environments: Environments, private val releases: ReleaseService) {

    @GET
    fun list(): List<EnvironmentInfo> = environments.all()

    /** Every market and account type live in {env}, with the release JSON it runs. */
    @GET
    @Path("/{env}/live")
    fun live(@PathParam("env") env: String): List<LiveRelease> = releases.live(env(env))

    @GET
    @Path("/{env}/capabilities")
    fun capabilities(@PathParam("env") env: String): Capabilities = releases.capabilities(env(env))
}
