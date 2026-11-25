package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.catalog.Catalog
import com.amex.billpay.onboarding.model.MarketConfig
import com.fasterxml.jackson.databind.ObjectMapper

/**
 * The one way a stored market document is read and written. Reading brings a stored document up to today's names, so
 * nothing downstream sees an API name the spec has since renamed.
 */
object MarketConfigs {

    fun read(mapper: ObjectMapper, json: String): MarketConfig {
        val config = mapper.readValue(json, MarketConfig::class.java)
        return config.copy(profiles = config.profiles.map { it.copy(apis = Catalog.currentApiNames(it.apis)) })
    }

    fun write(mapper: ObjectMapper, config: MarketConfig): String = mapper.writeValueAsString(config)
}
