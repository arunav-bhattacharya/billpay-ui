package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.catalog.Catalog
import com.amex.billpay.onboarding.entity.MarketEntity
import com.amex.billpay.onboarding.entity.MarketRevisionEntity
import com.amex.billpay.onboarding.model.AccountType
import com.amex.billpay.onboarding.model.BehaviorValue
import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.MarketConfig
import com.amex.billpay.onboarding.model.MarketDocument
import com.amex.billpay.onboarding.model.MarketInfo
import com.amex.billpay.onboarding.model.MarketProfile
import com.amex.billpay.onboarding.model.MarketRevision
import com.amex.billpay.onboarding.model.RevisionAction
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import jakarta.transaction.Transactional
import jakarta.ws.rs.WebApplicationException
import jakarta.ws.rs.core.Response
import java.time.Instant
import java.util.UUID

@ApplicationScoped
class MarketService(
    private val objectMapper: ObjectMapper,
    private val serviceNow: ServiceNowClient,
) {

    // ---- mapping ----

    fun toDocument(entity: MarketEntity): MarketDocument {
        val config = objectMapper.readValue(entity.configJson, MarketConfig::class.java)
        // Stored order is whatever order the profiles were added in; every
        // reader wants them in account-type order, so sort once here rather
        // than at each of the half-dozen places the UI renders them.
        val profiles = config.profiles.sortedBy { it.accountType }
        return MarketDocument(
            market = MarketInfo(
                code = entity.code,
                name = entity.name,
                currency = entity.currency,
                region = entity.region,
            ),
            status = deriveStatus(profiles),
            customDimensionDefs = config.customDimensionDefs,
            profiles = profiles,
            readiness = Readiness.forProfiles(profiles, entity.createdAt),
            createdAt = entity.createdAt,
            updatedAt = entity.updatedAt,
        )
    }

    /** A market sits at the furthest environment any of its profiles has reached. */
    private fun deriveStatus(profiles: List<MarketProfile>): EnvStage =
        profiles.maxOfOrNull { it.status } ?: EnvStage.E1

    /**
     * Only [MarketConfig] is persisted, so derived fields on the document —
     * status, readiness — are dropped here rather than written back.
     */
    private fun writeConfig(document: MarketDocument): String =
        objectMapper.writeValueAsString(
            MarketConfig(
                customDimensionDefs = document.customDimensionDefs,
                profiles = document.profiles,
            )
        )

    private fun readConfig(entity: MarketEntity): MarketConfig =
        objectMapper.readValue(entity.configJson, MarketConfig::class.java)

    // ---- queries ----

    fun listAll(): List<MarketDocument> =
        MarketEntity.listAll().map { toDocument(it) }.sortedBy { it.market.code }

    fun getByCode(code: String): MarketDocument =
        toDocument(requireEntity(code))

    fun revisions(code: String): List<MarketRevision> {
        val entity = requireEntity(code)
        return MarketRevisionEntity.findByMarket(entity.code).map {
            MarketRevision(
                id = it.id ?: 0,
                action = it.action,
                actor = it.actor,
                summary = it.summary,
                envs = readEnvs(it.envs),
                profileLabel = it.profileLabel,
                beforeJson = it.beforeJson,
                afterJson = it.afterJson,
                at = it.at,
            )
        }
    }

    private fun requireEntity(code: String): MarketEntity =
        MarketEntity.findByCode(code.uppercase())
            ?: throw WebApplicationException("Market '$code' not found", Response.Status.NOT_FOUND)

    // ---- revision recording ----

    /**
     * There is no authentication; the caller passes the UI role through so the
     * history says who was acting rather than silently attributing everything
     * to the same anonymous user.
     */
    private fun record(
        code: String,
        action: RevisionAction,
        actor: String,
        summary: String,
        envs: List<EnvStage>,
        at: Instant,
        profileLabel: String? = null,
        before: MarketConfig? = null,
        after: MarketConfig? = null,
    ) {
        MarketRevisionEntity().apply {
            this.marketCode = code
            this.action = action
            this.actor = actor.ifBlank { "OPERATOR" }.uppercase()
            this.summary = summary.take(1024)
            this.envs = writeEnvs(envs)
            this.profileLabel = profileLabel
            this.beforeJson = before?.let { objectMapper.writeValueAsString(it) }
            this.afterJson = after?.let { objectMapper.writeValueAsString(it) }
            this.at = at
        }.persist()
    }

    /**
     * Which environments a change belongs to.
     *
     * A profile's stage is the environment its work is being done in, so a
     * change is recorded against the stages of the profiles it touched — that
     * is what keeps each environment's history its own rather than three
     * copies of the same list. A change with no profile of its own, such as
     * defining a custom behavior, lands in every stage the market occupies.
     */
    private fun envsOf(touched: Collection<MarketProfile>, whole: MarketConfig? = null): List<EnvStage> =
        touched.map { it.status }
            .ifEmpty { whole?.profiles.orEmpty().map { it.status } }
            .distinct()
            .sorted()

    /** Profiles that differ between two configs, each at the stage it ends up in. */
    private fun touchedProfiles(before: MarketConfig, after: MarketConfig): List<MarketProfile> {
        val was = before.profiles.associateBy { it.accountType }
        val isNow = after.profiles.map { it.accountType }.toSet()
        // A removed profile is named at the stage it was removed from — there
        // is no "after" state for it to be read from.
        return after.profiles.filter { it != was[it.accountType] } +
            before.profiles.filter { it.accountType !in isNow }
    }

    private fun writeEnvs(envs: List<EnvStage>): String? =
        envs.takeIf { it.isNotEmpty() }?.joinToString(",") { it.name }

    private fun readEnvs(raw: String?): List<EnvStage> =
        raw?.split(",").orEmpty().filter { it.isNotBlank() }.map { EnvStage.valueOf(it) }

    /**
     * Writes the one revision a market seeded before the history existed is
     * missing, so its page is not blank. Stamped with the market's own
     * createdAt, never the boot time.
     */
    @Transactional
    fun backfillRevisions() {
        MarketEntity.listAll()
            .filter { MarketRevisionEntity.countForMarket(it.code) == 0L }
            .forEach { entity ->
                val config = readConfig(entity)
                record(
                    code = entity.code,
                    action = RevisionAction.CREATED,
                    actor = "SYSTEM",
                    summary = RevisionSummary.created(config),
                    envs = envsOf(config.profiles),
                    at = entity.createdAt,
                    after = config,
                )
            }

        // Rows recorded before the history was split by environment. Their
        // stored before/after pair carries everything the derivation needs, so
        // they land in exactly the environments a fresh row would; a row with
        // no document to read from is attributed to e1, where markets start.
        MarketRevisionEntity.findWithoutEnvs().forEach { row ->
            val before = row.beforeJson?.let { objectMapper.readValue(it, MarketConfig::class.java) }
            val after = row.afterJson?.let { objectMapper.readValue(it, MarketConfig::class.java) }
            val touched = when {
                before != null && after != null -> touchedProfiles(before, after)
                else -> after?.profiles.orEmpty()
            }
            row.envs = writeEnvs(envsOf(touched, after)) ?: EnvStage.E1.name
        }
    }

    // ---- commands ----

    @Transactional
    fun create(document: MarketDocument, actor: String = "OPERATOR"): MarketDocument {
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
        val after = readConfig(entity)
        record(
            code = code,
            action = RevisionAction.CREATED,
            actor = actor,
            summary = RevisionSummary.created(after),
            envs = envsOf(after.profiles),
            at = now,
            after = after,
        )
        return toDocument(entity)
    }

    @Transactional
    fun update(code: String, document: MarketDocument, actor: String = "OPERATOR"): MarketDocument {
        val entity = requireEntity(code)
        validate(document)
        val before = readConfig(entity)
        entity.name = document.market.name.ifBlank { entity.name }
        entity.currency = document.market.currency.ifBlank { entity.currency }
        entity.region = document.market.region.ifBlank { entity.region }
        entity.configJson = writeConfig(document)
        entity.updatedAt = Instant.now()
        val after = readConfig(entity)
        record(
            code = entity.code,
            action = RevisionAction.UPDATED,
            actor = actor,
            summary = RevisionSummary.updated(before, after),
            envs = envsOf(touchedProfiles(before, after), after),
            at = entity.updatedAt,
            before = before,
            after = after,
        )
        return toDocument(entity)
    }

    @Transactional
    fun delete(code: String) {
        val entity = requireEntity(code)
        // The history is keyed by code, so it would outlive the market it describes.
        MarketRevisionEntity.deleteForMarket(entity.code)
        entity.delete()
    }

    /**
     * Advance profiles one environment. With no [profileId] every profile that
     * still has somewhere to go and has been signed off moves up a stage;
     * profiles already at E3 are left alone, and the call only fails when
     * nothing could be promoted.
     */
    @Transactional
    fun promote(code: String, profileId: String?, actor: String = "OPERATOR"): MarketDocument {
        val entity = requireEntity(code)
        val config = readConfig(entity)
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
        // An environment has to be signed off before anything leaves it: that
        // is what makes the readiness the UI shows a gate rather than a label.
        if (targets.none { it.status.next() != null && Readiness.isSignedOff(it) }) {
            throw WebApplicationException(
                if (profileId != null) {
                    "${RevisionSummary.accountTypeLabel(targets.first().accountType)} has not been " +
                        "verified in ${targets.first().status.name.lowercase()} yet"
                } else {
                    "No profile in '$code' has been verified in the environment it is in"
                },
                Response.Status.CONFLICT,
            )
        }
        fun canPromote(p: MarketProfile) =
            (profileId == null || p.id == profileId) && p.status.next() != null && Readiness.isSignedOff(p)

        val profiles = config.profiles.map {
            if (canPromote(it)) it.copy(status = it.status.next()!!) else it
        }
        val after = config.copy(profiles = profiles)
        entity.configJson = objectMapper.writeValueAsString(after)
        entity.updatedAt = Instant.now()

        val movedIds = config.profiles.filter { canPromote(it) }.map { it.id }.toSet()
        val moved = profiles.filter { it.id in movedIds }
        record(
            code = entity.code,
            action = RevisionAction.PROMOTED,
            actor = actor,
            summary = RevisionSummary.promoted(moved),
            // `moved` already carries the new stage, so a promotion is filed
            // under the environment it arrives in, not the one it left.
            envs = envsOf(moved),
            at = entity.updatedAt,
            profileLabel = moved.singleOrNull()?.let { RevisionSummary.accountTypeLabel(it.accountType) },
            before = config,
            after = after,
        )
        return toDocument(entity)
    }

    /**
     * Sign off the environment a profile currently occupies, which completes
     * its verification step and releases it for promotion.
     */
    @Transactional
    fun verifyProfile(code: String, profileId: String, actor: String = "OPERATOR"): MarketDocument {
        val entity = requireEntity(code)
        val config = readConfig(entity)
        val profile = requireProfile(config, profileId, code)
        if (Readiness.isSignedOff(profile)) {
            throw WebApplicationException(
                "${RevisionSummary.accountTypeLabel(profile.accountType)} is already verified in " +
                    profile.status.name.lowercase(),
                Response.Status.CONFLICT,
            )
        }
        val after = config.copy(
            profiles = config.profiles.map {
                if (it.id == profileId) it.copy(verifiedIn = it.status) else it
            }
        )
        entity.configJson = objectMapper.writeValueAsString(after)
        entity.updatedAt = Instant.now()
        record(
            code = entity.code,
            action = RevisionAction.VERIFIED,
            actor = actor,
            summary = RevisionSummary.verified(profile),
            envs = listOf(profile.status),
            at = entity.updatedAt,
            profileLabel = RevisionSummary.accountTypeLabel(profile.accountType),
            before = config,
            after = after,
        )
        return toDocument(entity)
    }

    /**
     * Validate a change request against ServiceNow and, if it holds, record it
     * as the authorisation for this profile's production configuration. An
     * unapproved number is never stored.
     */
    @Transactional
    fun recordRfc(
        code: String,
        profileId: String,
        rfcNumber: String,
        actor: String = "OPERATOR",
    ): MarketDocument {
        val entity = requireEntity(code)
        val config = readConfig(entity)
        val profile = requireProfile(config, profileId, code)
        if (profile.status != EnvStage.E3) {
            throw WebApplicationException(
                "A change request is only needed in ${EnvStage.E3.name.lowercase()}; " +
                    "${RevisionSummary.accountTypeLabel(profile.accountType)} is in " +
                    profile.status.name.lowercase(),
                Response.Status.CONFLICT,
            )
        }
        val number = rfcNumber.trim()
        if (number.isBlank()) {
            throw WebApplicationException("Enter a change request number", Response.Status.BAD_REQUEST)
        }
        val result = serviceNow.validate(number)
        if (!result.valid) {
            throw WebApplicationException(result.message, Response.Status.BAD_REQUEST)
        }
        val after = config.copy(
            profiles = config.profiles.map {
                if (it.id == profileId) it.copy(rfcNumber = number) else it
            }
        )
        entity.configJson = objectMapper.writeValueAsString(after)
        entity.updatedAt = Instant.now()
        record(
            code = entity.code,
            action = RevisionAction.RFC_RECORDED,
            actor = actor,
            summary = RevisionSummary.rfcRecorded(profile, number),
            envs = listOf(EnvStage.E3),
            at = entity.updatedAt,
            profileLabel = RevisionSummary.accountTypeLabel(profile.accountType),
            before = config,
            after = after,
        )
        return toDocument(entity)
    }

    private fun requireProfile(config: MarketConfig, profileId: String, code: String): MarketProfile =
        config.profiles.find { it.id == profileId }
            ?: throw WebApplicationException(
                "Profile '$profileId' not found in market '$code'", Response.Status.NOT_FOUND
            )

    /** Remove a single account-type profile; the market itself stays. */
    @Transactional
    fun deleteProfile(code: String, profileId: String, actor: String = "OPERATOR"): MarketDocument {
        val entity = requireEntity(code)
        val config = readConfig(entity)
        val removed = config.profiles.find { it.id == profileId }
            ?: throw WebApplicationException("Profile '$profileId' not found in market '$code'", Response.Status.NOT_FOUND)
        val after = config.copy(profiles = config.profiles.filterNot { it.id == profileId })
        entity.configJson = objectMapper.writeValueAsString(after)
        entity.updatedAt = Instant.now()
        record(
            code = entity.code,
            action = RevisionAction.PROFILE_DELETED,
            actor = actor,
            summary = RevisionSummary.profileDeleted(removed),
            envs = envsOf(listOf(removed)),
            at = entity.updatedAt,
            profileLabel = RevisionSummary.accountTypeLabel(removed.accountType),
            before = config,
            after = after,
        )
        return toDocument(entity)
    }

    @Transactional
    fun clone(
        sourceCode: String,
        targetCode: String,
        accountTypes: List<AccountType>? = null,
        actor: String = "OPERATOR",
    ): MarketDocument {
        val source = requireEntity(sourceCode)
        val target = targetCode.uppercase()
        if (MarketEntity.findByCode(target) != null) {
            throw WebApplicationException("Market '$target' is already onboarded", Response.Status.CONFLICT)
        }
        val curated = Catalog.marketsByCode[target]
            ?: throw WebApplicationException("'$target' is not a recognized Amex market", Response.Status.BAD_REQUEST)

        val config = readConfig(source)
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
        record(
            code = target,
            action = RevisionAction.CLONED,
            actor = actor,
            summary = RevisionSummary.cloned(source.name, cloned.profiles),
            envs = envsOf(cloned.profiles),
            at = now,
            after = cloned,
        )
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
            val b = p.dimensions
            if (b.requiresRepresentableReturn == BehaviorValue.BOTH) {
                throw WebApplicationException(
                    "Representable Return must be Y or N, not BOTH (${p.accountType})",
                    Response.Status.BAD_REQUEST,
                )
            }
            if (b.requiresRealtimeClearing == BehaviorValue.Y && b.requiresRepresentableReturn != BehaviorValue.N) {
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
                "Custom behavior value(s) without a definition: ${undefinedUse.distinct().joinToString()}",
                Response.Status.BAD_REQUEST
            )
        }
    }
}
