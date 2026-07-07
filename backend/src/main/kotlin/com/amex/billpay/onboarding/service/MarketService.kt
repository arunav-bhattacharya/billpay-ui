package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.catalog.Catalog
import com.amex.billpay.onboarding.entity.MarketEntity
import com.amex.billpay.onboarding.model.AccountType
import com.amex.billpay.onboarding.model.LifecycleStatus
import com.amex.billpay.onboarding.model.MarketConfig
import com.amex.billpay.onboarding.model.MarketDocument
import com.amex.billpay.onboarding.model.MarketProfile
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import jakarta.transaction.Transactional
import jakarta.ws.rs.WebApplicationException
import jakarta.ws.rs.core.Response
import java.time.Instant
import java.util.UUID

@ApplicationScoped
class MarketService(private val objectMapper: ObjectMapper) {

    // ---- mapping ----

    fun toDocument(entity: MarketEntity): MarketDocument {
        val config = objectMapper.readValue(entity.configJson, MarketConfig::class.java)
        return MarketDocument(
            code = entity.code,
            name = entity.name,
            currency = entity.currency,
            region = entity.region,
            status = deriveStatus(config.profiles),
            customDimensionDefs = config.customDimensionDefs,
            profiles = config.profiles,
            createdAt = entity.createdAt,
            updatedAt = entity.updatedAt,
        )
    }

    private fun deriveStatus(profiles: List<MarketProfile>): LifecycleStatus =
        if (profiles.any { it.status == LifecycleStatus.ACTIVE }) LifecycleStatus.ACTIVE
        else LifecycleStatus.DRAFT

    private fun writeConfig(document: MarketDocument): String =
        objectMapper.writeValueAsString(
            MarketConfig(
                customDimensionDefs = document.customDimensionDefs,
                profiles = document.profiles,
            )
        )

    // ---- queries ----

    fun listAll(): List<MarketDocument> =
        MarketEntity.listAll().map { toDocument(it) }.sortedBy { it.code }

    fun getByCode(code: String): MarketDocument =
        toDocument(requireEntity(code))

    private fun requireEntity(code: String): MarketEntity =
        MarketEntity.findByCode(code.uppercase())
            ?: throw WebApplicationException("Market '$code' not found", Response.Status.NOT_FOUND)

    // ---- commands ----

    @Transactional
    fun create(document: MarketDocument): MarketDocument {
        val code = document.code.uppercase()
        if (MarketEntity.findByCode(code) != null) {
            throw WebApplicationException("Market '$code' is already onboarded", Response.Status.CONFLICT)
        }
        val curated = Catalog.marketsByCode[code]
            ?: throw WebApplicationException("'$code' is not a recognized Amex market", Response.Status.BAD_REQUEST)
        validate(document)

        val now = Instant.now()
        val entity = MarketEntity().apply {
            this.code = code
            this.name = document.name.ifBlank { curated.name }
            this.currency = document.currency.ifBlank { curated.currency }
            this.region = document.region.ifBlank { curated.region }
            this.configJson = writeConfig(document)
            this.createdAt = now
            this.updatedAt = now
        }
        entity.persist()
        return toDocument(entity)
    }

    @Transactional
    fun update(code: String, document: MarketDocument): MarketDocument {
        val entity = requireEntity(code)
        validate(document)
        entity.name = document.name.ifBlank { entity.name }
        entity.currency = document.currency.ifBlank { entity.currency }
        entity.region = document.region.ifBlank { entity.region }
        entity.configJson = writeConfig(document)
        entity.updatedAt = Instant.now()
        return toDocument(entity)
    }

    @Transactional
    fun delete(code: String) {
        requireEntity(code).delete()
    }

    @Transactional
    fun activate(code: String, profileId: String?): MarketDocument {
        val entity = requireEntity(code)
        val config = objectMapper.readValue(entity.configJson, MarketConfig::class.java)
        if (profileId != null && config.profiles.none { it.id == profileId }) {
            throw WebApplicationException("Profile '$profileId' not found in market '$code'", Response.Status.NOT_FOUND)
        }
        val profiles = config.profiles.map {
            if (profileId == null || it.id == profileId) it.copy(status = LifecycleStatus.ACTIVE) else it
        }
        entity.configJson = objectMapper.writeValueAsString(config.copy(profiles = profiles))
        entity.updatedAt = Instant.now()
        return toDocument(entity)
    }

    /** Remove a single account-type profile; the market itself stays. */
    @Transactional
    fun deleteProfile(code: String, profileId: String): MarketDocument {
        val entity = requireEntity(code)
        val config = objectMapper.readValue(entity.configJson, MarketConfig::class.java)
        if (config.profiles.none { it.id == profileId }) {
            throw WebApplicationException("Profile '$profileId' not found in market '$code'", Response.Status.NOT_FOUND)
        }
        val profiles = config.profiles.filterNot { it.id == profileId }
        entity.configJson = objectMapper.writeValueAsString(config.copy(profiles = profiles))
        entity.updatedAt = Instant.now()
        return toDocument(entity)
    }

    @Transactional
    fun clone(sourceCode: String, targetCode: String, accountTypes: List<AccountType>? = null): MarketDocument {
        val source = requireEntity(sourceCode)
        val target = targetCode.uppercase()
        if (MarketEntity.findByCode(target) != null) {
            throw WebApplicationException("Market '$target' is already onboarded", Response.Status.CONFLICT)
        }
        val curated = Catalog.marketsByCode[target]
            ?: throw WebApplicationException("'$target' is not a recognized Amex market", Response.Status.BAD_REQUEST)

        val config = objectMapper.readValue(source.configJson, MarketConfig::class.java)
        // Only the selected account types come along (null/empty = all).
        val wanted = accountTypes?.toSet() ?: emptySet()
        val selected = config.profiles.filter { wanted.isEmpty() || it.accountType in wanted }
        if (selected.isEmpty()) {
            throw WebApplicationException(
                "None of the requested account types exist in '$sourceCode'", Response.Status.BAD_REQUEST
            )
        }
        // Cloned profiles get fresh ids and start over as drafts.
        val cloned = config.copy(
            profiles = selected.map {
                it.copy(id = UUID.randomUUID().toString(), status = LifecycleStatus.DRAFT)
            }
        )
        val now = Instant.now()
        val entity = MarketEntity().apply {
            this.code = target
            this.name = curated.name
            this.currency = curated.currency
            this.region = curated.region
            this.configJson = objectMapper.writeValueAsString(cloned)
            this.createdAt = now
            this.updatedAt = now
        }
        entity.persist()
        return toDocument(entity)
    }

    // ---- validation ----

    private fun validate(document: MarketDocument) {
        val unknownApis = document.profiles.flatMap { it.apis }.filter { it !in Catalog.apisByName }
        if (unknownApis.isNotEmpty()) {
            throw WebApplicationException(
                "Unknown API(s): ${unknownApis.distinct().joinToString()}", Response.Status.BAD_REQUEST
            )
        }
        val duplicated = document.profiles.groupingBy { it.accountType }.eachCount().filterValues { it > 1 }
        if (duplicated.isNotEmpty()) {
            throw WebApplicationException(
                "Duplicate profile for account type(s): ${duplicated.keys.joinToString()}", Response.Status.CONFLICT
            )
        }
        val definedKeys = document.customDimensionDefs.map { it.key }.toSet()
        val undefinedUse = document.profiles.flatMap { it.customDimensions.keys }.filter { it !in definedKeys }
        if (undefinedUse.isNotEmpty()) {
            throw WebApplicationException(
                "Custom dimension value(s) without a definition: ${undefinedUse.distinct().joinToString()}",
                Response.Status.BAD_REQUEST
            )
        }
    }
}
