package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.catalog.Catalog
import com.amex.billpay.onboarding.entity.DeploymentEntity
import com.amex.billpay.onboarding.entity.MarketControlEntity
import com.amex.billpay.onboarding.entity.MarketEntity
import com.amex.billpay.onboarding.entity.MarketRevisionEntity
import com.amex.billpay.onboarding.entity.ReleaseEntity
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
import java.time.Duration
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/** Markets and their draft profiles: authoring. Releases, sign-offs and promotion are [ReleaseService]'s. */
@ApplicationScoped
class MarketService(
    private val objectMapper: ObjectMapper,
    private val revisions: RevisionLog,
    private val releases: ReleaseService,
) {

    // ---- mapping ----

    fun toDocument(entity: MarketEntity): MarketDocument {
        val config = readConfig(entity)
        // Stored order is whatever order the profiles were added in; every reader wants account-type order.
        val profiles = config.profiles.sortedBy { it.accountType }
        return MarketDocument(
            market = MarketInfo(code = entity.code, name = entity.name, currency = entity.currency, region = entity.region),
            status = profiles.maxOfOrNull { it.status } ?: EnvStage.E1,
            customDimensionDefs = config.customDimensionDefs,
            profiles = profiles,
            readiness = releases.readiness(entity.code, profiles),
            createdAt = entity.createdAt,
            updatedAt = entity.updatedAt,
        )
    }

    /** Only [MarketConfig] is persisted, so derived fields on the document (status, readiness) are dropped here. */
    private fun writeConfig(config: MarketConfig): String = MarketConfigs.write(objectMapper, config)

    private fun readConfig(entity: MarketEntity): MarketConfig = MarketConfigs.read(objectMapper, entity.configJson)

    private fun json(config: MarketConfig?): String? = config?.let { writeConfig(it) }

    // ---- queries ----

    fun listAll(): List<MarketDocument> =
        MarketEntity.listAll().map { toDocument(it) }.sortedBy { it.market.code }

    fun getByCode(code: String): MarketDocument = toDocument(requireEntity(code))

    fun revisions(code: String): List<MarketRevision> = revisions.forMarket(requireEntity(code).code)

    private fun requireEntity(code: String): MarketEntity =
        MarketEntity.findByCode(code.uppercase())
            ?: throw WebApplicationException("Market '$code' not found", Response.Status.NOT_FOUND)

    /**
     * Which environments a change belongs to: the stages of the profiles it touched, so each environment's history is
     * its own. A change with no profile of its own, such as defining a custom behavior, lands in every stage the
     * market occupies.
     */
    private fun envsOf(touched: Collection<MarketProfile>, whole: MarketConfig? = null): List<EnvStage> =
        touched.map { it.status }.ifEmpty { whole?.profiles.orEmpty().map { it.status } }.distinct().sorted()

    /** Profiles that differ between two configs, each at the stage it ends up in. */
    private fun touchedProfiles(before: MarketConfig, after: MarketConfig): List<MarketProfile> {
        val was = before.profiles.associateBy { it.accountType }
        val isNow = after.profiles.map { it.accountType }.toSet()
        return after.profiles.filter { it != was[it.accountType] } + before.profiles.filter { it.accountType !in isNow }
    }

    /**
     * Writes the one revision a market seeded before the history existed is missing, so its page is not blank, and
     * attributes rows recorded before the history was split by environment.
     */
    @Transactional
    fun backfillRevisions() {
        MarketEntity.listAll()
            .filter { MarketRevisionEntity.countForMarket(it.code) == 0L }
            .forEach { entity ->
                val config = readConfig(entity)
                revisions.record(
                    code = entity.code,
                    action = RevisionAction.CREATED,
                    actor = "SYSTEM",
                    summary = RevisionSummary.created(config),
                    envs = envsOf(config.profiles),
                    at = entity.createdAt,
                    afterJson = json(config),
                )
            }
        MarketRevisionEntity.findWithoutEnvs().forEach { row ->
            val before = row.beforeJson?.let { MarketConfigs.read(objectMapper, it) }
            val after = row.afterJson?.let { MarketConfigs.read(objectMapper, it) }
            val touched = if (before != null && after != null) touchedProfiles(before, after) else after?.profiles.orEmpty()
            row.envs = revisions.write(envsOf(touched, after)) ?: EnvStage.E1.name
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
        // Every profile starts in e1, where its first release goes; only promotion moves it on.
        val config = MarketConfig(
            customDimensionDefs = document.customDimensionDefs,
            profiles = document.profiles.map { it.copy(status = EnvStage.E1, apis = Catalog.currentApiNames(it.apis), editedBy = actor.uppercase()) },
        )
        val entity = MarketEntity().apply {
            this.code = code
            this.name = document.market.name.ifBlank { curated.name }
            this.currency = document.market.currency.ifBlank { curated.currency }
            this.region = document.market.region.ifBlank { curated.region }
            this.configJson = writeConfig(config)
            this.createdAt = now
            this.updatedAt = now
        }
        entity.persist()
        revisions.record(
            code = code,
            action = RevisionAction.CREATED,
            actor = actor,
            summary = RevisionSummary.created(config),
            envs = envsOf(config.profiles),
            at = now,
            afterJson = json(config),
        )
        return toDocument(entity)
    }

    @Transactional
    fun update(code: String, document: MarketDocument, actor: String = "OPERATOR"): MarketDocument {
        val entity = requireEntity(code)
        validate(document)
        val before = readConfig(entity)
        val stored = before.profiles.associateBy { it.id }
        // A profile's stage is the release pipeline's to move, never an edit's: an existing profile keeps its own,
        // and a new one starts in e1.
        val edited = MarketConfig(
            customDimensionDefs = document.customDimensionDefs,
            profiles = document.profiles.map {
                it.copy(
                    status = stored[it.id]?.status ?: EnvStage.E1,
                    apis = Catalog.currentApiNames(it.apis),
                    editedBy = stored[it.id]?.editedBy,
                )
            },
        )
        val touched = touchedProfiles(before, edited).map { it.id }.toSet()
        val after = edited.copy(profiles = edited.profiles.map { if (it.id in touched) it.copy(editedBy = actor.uppercase()) else it })
        val removed = before.profiles.filter { p -> after.profiles.none { it.id == p.id } }
        removed.forEach { refuseIfLive(entity.code, it.accountType) }

        entity.name = document.market.name.ifBlank { entity.name }
        entity.currency = document.market.currency.ifBlank { entity.currency }
        entity.region = document.market.region.ifBlank { entity.region }
        entity.configJson = writeConfig(after)
        entity.updatedAt = Instant.now()
        removed.forEach { dropReleases(entity.code, it.accountType) }
        revisions.record(
            code = entity.code,
            action = RevisionAction.UPDATED,
            actor = actor,
            summary = RevisionSummary.updated(before, after),
            envs = envsOf(touchedProfiles(before, after), after),
            at = entity.updatedAt,
            beforeJson = json(before),
            afterJson = json(after),
        )
        return toDocument(entity)
    }

    @Transactional
    fun delete(code: String) {
        val entity = requireEntity(code)
        refuseIfLive(entity.code, null)
        // The history and releases are keyed by code, so they would outlive the market they describe.
        MarketRevisionEntity.deleteForMarket(entity.code)
        ReleaseEntity.deleteForMarket(entity.code)
        DeploymentEntity.deleteForMarket(entity.code)
        MarketControlEntity.deleteForMarket(entity.code)
        entity.delete()
    }

    /** Remove a single account-type profile; the market itself stays. */
    @Transactional
    fun deleteProfile(code: String, profileId: String, actor: String = "OPERATOR"): MarketDocument {
        val entity = requireEntity(code)
        val config = readConfig(entity)
        val removed = config.profiles.find { it.id == profileId }
            ?: throw WebApplicationException("Profile '$profileId' not found in market '$code'", Response.Status.NOT_FOUND)
        refuseIfLive(entity.code, removed.accountType)
        val after = config.copy(profiles = config.profiles.filterNot { it.id == profileId })
        entity.configJson = writeConfig(after)
        entity.updatedAt = Instant.now()
        dropReleases(entity.code, removed.accountType)
        revisions.record(
            code = entity.code,
            action = RevisionAction.PROFILE_DELETED,
            actor = actor,
            summary = RevisionSummary.profileDeleted(removed),
            envs = envsOf(listOf(removed)),
            at = entity.updatedAt,
            profileLabel = RevisionSummary.accountTypeLabel(removed.accountType),
            beforeJson = json(config),
            afterJson = json(after),
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
        // Only the selected account types come along (null/empty = all), and only those the target supports.
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
        // Cloned profiles get fresh ids and start over in e1, with no releases. The test accounts are the source
        // market's own, so they don't come along.
        val cloned = config.copy(
            profiles = selected.map {
                it.copy(
                    id = UUID.randomUUID().toString(),
                    status = EnvStage.E1,
                    operations = it.operations.copy(testAccounts = emptyList()),
                    editedBy = actor.uppercase(),
                )
            },
        )
        val now = Instant.now()
        val entity = MarketEntity().apply {
            this.code = target
            this.name = curated.name
            this.currency = curated.currency
            this.region = curated.region
            this.configJson = writeConfig(cloned)
            this.createdAt = now
            this.updatedAt = now
        }
        entity.persist()
        revisions.record(
            code = target,
            action = RevisionAction.CLONED,
            actor = actor,
            summary = RevisionSummary.cloned(source.name, cloned.profiles),
            envs = envsOf(cloned.profiles),
            at = now,
            afterJson = json(cloned),
        )
        return toDocument(entity)
    }

    /**
     * A profile live through a real environment can't be deleted here: the Market Onboarding API has no call that
     * takes a profile out of service, so the environment would keep running a profile billpay-ui no longer knows.
     */
    private fun refuseIfLive(code: String, accountType: AccountType?) {
        releases.liveThroughApi(code, accountType)?.let {
            throw WebApplicationException(
                "${RevisionSummary.accountTypeLabel(it.accountType)} v${it.version} is live in ${it.env.name.lowercase()}; " +
                    "pause it there instead. The Market Onboarding API can't take a profile out of service.",
                Response.Status.CONFLICT,
            )
        }
    }

    private fun dropReleases(code: String, accountType: AccountType) {
        ReleaseEntity.deleteForProfile(code, accountType)
        DeploymentEntity.deleteForProfile(code, accountType)
        MarketControlEntity.deleteForProfile(code, accountType)
    }

    // ---- validation ----

    private fun validate(document: MarketDocument) {
        val curated = Catalog.marketsByCode[document.market.code.uppercase()]
        if (curated != null) {
            val disallowed = document.profiles.map { it.accountType }.filter { it !in curated.allowedAccountTypes }.distinct()
            if (disallowed.isNotEmpty()) {
                bad(
                    "${curated.name} does not support account type(s): ${disallowed.joinToString()}. " +
                        "Allowed: ${curated.allowedAccountTypes.joinToString()}",
                )
            }
        }
        val unknownApis = document.profiles.flatMap { Catalog.currentApiNames(it.apis) }.filter { it !in Catalog.apisByName }
        if (unknownApis.isNotEmpty()) bad("Unknown API(s): ${unknownApis.distinct().joinToString()}")
        val duplicated = document.profiles.groupingBy { it.accountType }.eachCount().filterValues { it > 1 }
        if (duplicated.isNotEmpty()) {
            throw WebApplicationException(
                "Duplicate profile for account type(s): ${duplicated.keys.joinToString()}", Response.Status.CONFLICT,
            )
        }
        document.profiles.forEach { validateProfile(it) }
        val definedKeys = document.customDimensionDefs.map { it.key }.toSet()
        val undefinedUse = document.profiles.flatMap { it.customDimensions.keys }.filter { it !in definedKeys }
        if (undefinedUse.isNotEmpty()) {
            bad("Custom behavior value(s) without a definition: ${undefinedUse.distinct().joinToString()}")
        }
    }

    /** The behaviors' account-type rules and the Operations settings' formats; the UI holds the same rules. */
    private fun validateProfile(p: MarketProfile) {
        val type = RevisionSummary.accountTypeLabel(p.accountType)
        Catalog.behaviors.forEach { meta ->
            val value = behaviorValue(p, meta.key)
            if (value != BehaviorValue.N && p.accountType !in meta.accountTypes) {
                bad("${meta.label} is N for $type: only ${meta.accountTypes.joinToString { RevisionSummary.accountTypeLabel(it) }} profiles take it")
            }
            if (value == BehaviorValue.BOTH && meta.bothRuleByJourney) {
                val journeys = p.operations.bothRules[meta.key].orEmpty()
                val unknown = journeys.filter { j -> Catalog.journeys.none { it.key == j } }
                if (unknown.isNotEmpty()) bad("Unknown journey(s) in ${meta.label}'s BOTH rule: ${unknown.joinToString()}")
            }
        }
        val ops = p.operations
        ops.timeZone?.takeIf { it.isNotBlank() }?.let { zone ->
            if (runCatching { ZoneId.of(zone) }.isFailure) bad("$type: '$zone' is not an IANA time zone")
        }
        ops.executionTime?.takeIf { it.isNotBlank() }?.let { time ->
            if (!Regex("\\d{2}:\\d{2}").matches(time) || runCatching { LocalTime.parse(time) }.isFailure) {
                bad("$type: the execution time is HH:mm, not '$time'")
            }
        }
        listOf(
            "cancellationWindow" to ops.cancellationWindow,
            "executionCutoff" to ops.executionCutoff,
            "allocationFetchBefore" to ops.allocationFetchBefore,
            "allocationAlertAfter" to ops.allocationAlertAfter,
            "pendingSweepAfter" to ops.pendingSweepAfter,
            "confirmationWindow" to ops.bankConfirmation?.confirmationWindow,
            "statusCheckDelay" to ops.bankConfirmation?.statusCheckDelay,
            "statusCheckInterval" to ops.bankConfirmation?.statusCheckInterval,
            "statusCheckMaxInterval" to ops.bankConfirmation?.statusCheckMaxInterval,
            "authenticationWindow" to ops.cardAuthentication?.authenticationWindow,
        ).forEach { (key, value) ->
            if (!value.isNullOrBlank() && runCatching { Duration.parse(value) }.isFailure) {
                bad("$type: $key is an ISO duration such as PT1H, not '$value'")
            }
        }
        ops.executionFloorTps?.let { if (it.signum() < 0) bad("$type: the execution floor can't be negative") }
        ops.representment?.let {
            if (it.maxRepresentments < 0 || it.delayDays < 0) bad("$type: representment counts can't be negative")
        }
        ops.ravenStatuses?.filter { it !in Catalog.paymentStatuses }?.takeIf { it.isNotEmpty() }?.let {
            bad("$type: unknown Raven status(es): ${it.joinToString()}")
        }
        ops.enrolledInstrumentStatuses.keys.filter { it !in Catalog.journeyContexts }.takeIf { it.isNotEmpty() }?.let {
            bad("$type: unknown journey context(s): ${it.joinToString()}")
        }
    }

    private fun behaviorValue(p: MarketProfile, key: String): BehaviorValue = when (key) {
        "requiresArPosting" -> p.dimensions.requiresArPosting
        "requiresRealtimeClearing" -> p.dimensions.requiresRealtimeClearing
        "requiresMandateAuthorization" -> p.dimensions.requiresMandateAuthorization
        "requiresBankConfirmation" -> p.dimensions.requiresBankConfirmation
        else -> BehaviorValue.N
    }

    private fun bad(message: String): Nothing = throw WebApplicationException(message, Response.Status.BAD_REQUEST)
}
