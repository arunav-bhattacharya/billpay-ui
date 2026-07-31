package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.catalog.Catalog
import com.amex.billpay.onboarding.entity.MarketEntity
import com.amex.billpay.onboarding.model.AccountType
import com.amex.billpay.onboarding.model.DimValue
import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.MarketConfig
import com.amex.billpay.onboarding.model.MarketDocument
import com.amex.billpay.onboarding.model.MarketInfo
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
            market = MarketInfo(
                code = entity.code,
                name = entity.name,
                currency = entity.currency,
                region = entity.region,
            ),
            status = deriveStatus(config.profiles),
            customDimensionDefs = config.customDimensionDefs,
            profiles = config.profiles,
            createdAt = entity.createdAt,
            updatedAt = entity.updatedAt,
        )
    }

    /** A market sits at the furthest environment any of its profiles has reached. */
    private fun deriveStatus(profiles: List<MarketProfile>): EnvStage =
        profiles.maxOfOrNull { it.status } ?: EnvStage.E1

    private fun writeConfig(document: MarketDocument): String =
        objectMapper.writeValueAsString(
            MarketConfig(
                customDimensionDefs = document.customDimensionDefs,
                profiles = document.profiles,
            )
        )

    // ---- queries ----

    fun listAll(): List<MarketDocument> =
        MarketEntity.listAll().map { toDocument(it) }.sortedBy { it.market.code }

    fun getByCode(code: String): MarketDocument =
        toDocument(requireEntity(code))

    private fun requireEntity(code: String): MarketEntity =
        MarketEntity.findByCode(code.uppercase())
            ?: throw WebApplicationException("Market '$code' not found", Response.Status.NOT_FOUND)

    // ---- commands ----

    @Transactional
    fun create(document: MarketDocument): MarketDocument {
        val code = document.market.code.uppercase()
        if (MarketEntity.findByCode(code) != null) {
            throw WebApplicationException("Market '$code' is already onboarded", Response.Status.CONFLICT)
        }
        val curated = Catalog.marketsByCode[code]
            ?: throw WebApplicationException("'$code' is not a recognized Amex market", Response.Status.BAD_REQUEST)
        validate(document)

        val now = Instant.now()
        val entity = MarketEntity().apply {
            this.code = code
            this.name = document.market.name.ifBlank { curated.name }
            this.currency = document.market.currency.ifBlank { curated.currency }
            this.region = document.market.region.ifBlank { curated.region }
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
        entity.name = document.market.name.ifBlank { entity.name }
        entity.currency = document.market.currency.ifBlank { entity.currency }
        entity.region = document.market.region.ifBlank { entity.region }
        entity.configJson = writeConfig(document)
        entity.updatedAt = Instant.now()
        return toDocument(entity)
    }

    @Transactional
    fun delete(code: String) {
        requireEntity(code).delete()
    }

    /**
     * Advance profiles one environment. With no [profileId] every profile that
     * still has somewhere to go moves up a stage; profiles already at E3 are
     * left alone, and the call only fails when nothing could be promoted.
     */
    @Transactional
    fun promote(code: String, profileId: String?): MarketDocument {
        val entity = requireEntity(code)
        val config = objectMapper.readValue(entity.configJson, MarketConfig::class.java)
        val targets = config.profiles.filter { profileId == null || it.id == profileId }
        if (profileId != null && targets.isEmpty()) {
            throw WebApplicationException("Profile '$profileId' not found in market '$code'", Response.Status.NOT_FOUND)
        }
        if (targets.none { it.status.next() != null }) {
            throw WebApplicationException(
                if (profileId != null) "Profile is already in ${EnvStage.E3}"
                else "Every profile in '$code' is already in ${EnvStage.E3}",
                Response.Status.CONFLICT,
            )
        }
        val profiles = config.profiles.map {
            val target = profileId == null || it.id == profileId
            val next = it.status.next()
            if (target && next != null) it.copy(status = next) else it
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
        // Only the selected account types come along (null/empty = all),
        // and only those the target market supports.
        val wanted = accountTypes?.toSet() ?: emptySet()
        val selected = config.profiles
            .filter { wanted.isEmpty() || it.accountType in wanted }
            .filter { it.accountType in curated.allowedAccountTypes }
        if (selected.isEmpty()) {
            throw WebApplicationException(
                "No cloneable profiles: '$sourceCode' has none of the requested account types " +
                    "that '${curated.name}' supports (${curated.allowedAccountTypes.joinToString()})",
                Response.Status.BAD_REQUEST,
            )
        }
        // Cloned profiles get fresh ids and start over in e1.
        val cloned = config.copy(
            profiles = selected.map {
                it.copy(id = UUID.randomUUID().toString(), status = EnvStage.E1)
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
        val curated = Catalog.marketsByCode[document.market.code.uppercase()]
        if (curated != null) {
            val disallowed = document.profiles
                .map { it.accountType }
                .filter { it !in curated.allowedAccountTypes }
                .distinct()
            if (disallowed.isNotEmpty()) {
                throw WebApplicationException(
                    "${curated.name} does not support account type(s): ${disallowed.joinToString()}. " +
                        "Allowed: ${curated.allowedAccountTypes.joinToString()}",
                    Response.Status.BAD_REQUEST,
                )
            }
        }
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
        // Representable Return is strictly Y/N, and is only offered when clearing
        // is not fully realtime. The UI enforces this too; this is the backstop.
        document.profiles.forEach { p ->
            val d = p.dimensions
            if (d.requiresRepresentableReturn == DimValue.BOTH) {
                throw WebApplicationException(
                    "Representable Return must be Y or N, not BOTH (${p.accountType})",
                    Response.Status.BAD_REQUEST,
                )
            }
            if (d.requiresRealtimeClearing == DimValue.Y && d.requiresRepresentableReturn != DimValue.N) {
                throw WebApplicationException(
                    "Representable Return must be N when Realtime Clearing is Y (${p.accountType})",
                    Response.Status.BAD_REQUEST,
                )
            }
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
