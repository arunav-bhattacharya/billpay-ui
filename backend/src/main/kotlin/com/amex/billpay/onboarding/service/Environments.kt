package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.model.EnvMode
import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.EnvironmentInfo
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import org.eclipse.microprofile.config.ConfigProvider

/**
 * Where each environment's Market Onboarding API is: `billpay.environments.e1.url` and so on, each environment's
 * billpay-offline. An environment with no URL is SIMULATED, a marked placeholder: billpay-ui walks its releases through
 * the workflow's steps itself, so the pipeline still reads end to end. Locally E1 is the billpay-offline on :8081 and
 * E2 and E3 are simulated, since one local billpay-offline can't stand for three environments: a release's workflow ID
 * is the same in each.
 */
@ApplicationScoped
class Environments(private val mapper: ObjectMapper) {

    private val clients: Map<EnvStage, MarketOnboardingClient> = EnvStage.entries.mapNotNull { env ->
        url(env)?.let { env to MarketOnboardingClient(env, it, mapper) }
    }.toMap()

    /** The environment's API, or null when it is simulated. */
    fun client(env: EnvStage): MarketOnboardingClient? = clients[env]

    fun mode(env: EnvStage): EnvMode = if (env in clients) EnvMode.CONNECTED else EnvMode.SIMULATED

    fun all(): List<EnvironmentInfo> = EnvStage.entries.map {
        EnvironmentInfo(env = it, name = NAMES.getValue(it), mode = mode(it), url = clients[it]?.baseUrl, rfcRequired = it == EnvStage.E3)
    }

    private fun url(env: EnvStage): String? =
        ConfigProvider.getConfig()
            .getOptionalValue("billpay.environments.${env.name.lowercase()}.url", String::class.java)
            .orElse(null)
            ?.trim()
            ?.takeIf { it.isNotEmpty() }

    private companion object {
        val NAMES = mapOf(EnvStage.E1 to "Development", EnvStage.E2 to "Testing", EnvStage.E3 to "Production")
    }
}
