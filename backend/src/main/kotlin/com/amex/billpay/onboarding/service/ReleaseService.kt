package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.entity.DeploymentEntity
import com.amex.billpay.onboarding.entity.MarketControlEntity
import com.amex.billpay.onboarding.entity.MarketEntity
import com.amex.billpay.onboarding.entity.ReleaseEntity
import com.amex.billpay.onboarding.model.AccountType
import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.LiveRelease
import com.amex.billpay.onboarding.model.MarketConfig
import com.amex.billpay.onboarding.model.MarketProfile
import com.amex.billpay.onboarding.model.ProfileReadiness
import com.amex.billpay.onboarding.model.ReleaseStatus
import com.amex.billpay.onboarding.model.ReleaseStep
import com.amex.billpay.onboarding.model.ReleaseView
import com.amex.billpay.onboarding.model.RevisionAction
import com.fasterxml.jackson.databind.ObjectMapper
import io.quarkus.narayana.jta.QuarkusTransaction
import jakarta.enterprise.context.ApplicationScoped
import jakarta.ws.rs.WebApplicationException
import jakarta.ws.rs.core.Response
import org.eclipse.microprofile.config.inject.ConfigProperty
import java.time.Duration
import java.time.Instant

/**
 * A profile's releases through E1, E2 and E3 (wiki, "From draft to live"):
 * 1. **Freeze** the draft as release vN: its release JSON, checksum, author and approver; it never changes.
 * 2. **Send** vN to E1's Market Onboarding API ([release]); sending is idempotent, so a send the environment couldn't
 *    take is retried by the tracker.
 * 3. **Track**: a deployment row per release and environment follows its workflow ([refresh]); readiness reads it.
 * 4. **Sign off** ([verifyProfile]) through the same API; in E3 only once [recordRfc] has passed ServiceNow's check.
 * 5. **Promote** ([promote]): once vN is active, and so signed off, in one environment, the same vN goes to the next.
 *
 * [rollback], [pause] and [resume] act on a live profile without a new release. Calls to an environment run outside
 * any transaction, so a slow billpay-offline never holds a database transaction open.
 *
 * A deployment row marked simulated (an environment with no API configured, or a seeded row) is walked through the
 * same steps by [simulate], following billpay-core's documented behavior, and never reaches an API.
 */
@ApplicationScoped
class ReleaseService(
    private val mapper: ObjectMapper,
    private val environments: Environments,
    private val revisions: RevisionLog,
    private val serviceNow: ServiceNowClient,
    /** The simulated workflow's pace: one beat per step, eight to its wait for a sign-off. */
    @param:ConfigProperty(name = "billpay.simulated.beat", defaultValue = "1s") private val beat: Duration,
) {

    // ---- reads ----

    fun readiness(code: String, profiles: List<MarketProfile>): List<ProfileReadiness> {
        val deployments = DeploymentEntity.forMarket(code)
        return profiles.map { profile ->
            val latest = ReleaseEntity.forProfile(code, profile.accountType).firstOrNull()
            val draft = ReleaseJson.checksum(mapper.writeValueAsString(ReleaseJson.build(profile, mapper)))
            Readiness.forProfile(
                profile = profile,
                deployments = deployments.filter { it.accountType == profile.accountType },
                controls = EnvStage.entries.associateWith { MarketControlEntity.latest(code, profile.accountType, it) },
                modes = environments::mode,
                latestVersion = latest?.version,
                draftChanged = latest?.checksum != draft,
            )
        }
    }

    fun releases(code: String, profileId: String): List<ReleaseView> {
        val (_, profile) = load(code, profileId)
        return ReleaseEntity.forProfile(code.uppercase(), profile.accountType).map {
            ReleaseView(it.version, it.accountType, it.checksum, it.author, it.approver, it.createdAt, mapper.readTree(it.configJson))
        }
    }

    /** The release JSON the draft would freeze as, without freezing it. */
    fun draftJson(code: String, profileId: String): Any = ReleaseJson.build(load(code, profileId).second, mapper)

    /** The deployed build's capability manifest in [env], straight from its API. */
    fun capabilities(env: EnvStage): Capabilities {
        val client = environments.client(env)
            ?: throw WebApplicationException("${env.label} is simulated: it has no capability manifest", Response.Status.NOT_FOUND)
        return guarded { client.capabilities() }
    }

    /** Every market and account type live in [env], with the release it runs: what the runs line and the manifest read. */
    fun live(env: EnvStage): List<LiveRelease> {
        val markets = MarketEntity.listAll().associateBy { it.code }
        return DeploymentEntity.list("env = ?1 and status = ?2", env, ReleaseStatus.ACTIVE).mapNotNull { d ->
            val market = markets[d.marketCode] ?: return@mapNotNull null
            val release = ReleaseEntity.find(d.marketCode, d.accountType, d.version) ?: return@mapNotNull null
            LiveRelease(
                market = d.marketCode,
                marketName = market.name,
                region = market.region,
                accountType = d.accountType,
                version = d.version,
                simulated = d.simulated,
                paused = MarketControlEntity.latest(d.marketCode, d.accountType, env)?.paused == true,
                since = d.updatedAt,
                config = mapper.readTree(release.configJson),
            )
        }.sortedWith(compareBy({ it.market }, { it.accountType }))
    }

    /** Whether any profile of the market is live through a real environment, which deleting it would orphan. */
    fun liveThroughApi(code: String, accountType: AccountType? = null): DeploymentEntity? =
        DeploymentEntity.forMarket(code).firstOrNull {
            !it.simulated && it.status == ReleaseStatus.ACTIVE && (accountType == null || it.accountType == accountType)
        }

    // ---- 1 and 2: freeze and send to E1 ----

    /**
     * Freezes the draft as the next version, or reuses the newest version when nothing has changed and it hasn't been
     * to E1 yet, and sends it to E1. The approver is whoever releases it; the author whoever last edited the profile.
     * Maker-checker: the author can't approve their own change (wiki: approval once, on the content). `TODO(sso)`: the
     * two are the UI's roles until SSO names people.
     */
    fun release(code: String, profileId: String, actor: String) {
        val id = tx {
            val (entity, profile) = load(code, profileId)
            if (profile.apis.isEmpty()) conflict("Select at least one API before releasing")
            val type = profile.accountType
            if (profile.editedBy != null && profile.editedBy.equals(actor.trim(), ignoreCase = true)) {
                conflict("${actor.uppercase()} made the last change to this profile, so someone else approves its release")
            }
            inFlight(entity.code, type, EnvStage.E1)?.let {
                conflict("v${it.version} is still ${it.status.phrase} in e1; finish it before releasing another version")
            }
            val json = mapper.writeValueAsString(ReleaseJson.build(profile, mapper))
            val checksum = ReleaseJson.checksum(json)
            val latest = ReleaseEntity.forProfile(entity.code, type).firstOrNull()
            val reusable = latest != null && latest.checksum == checksum &&
                DeploymentEntity.find(entity.code, type, latest.version, EnvStage.E1) == null
            if (latest != null && latest.checksum == checksum && !reusable) {
                val there = DeploymentEntity.find(entity.code, type, latest.version, EnvStage.E1)!!
                if (there.status == ReleaseStatus.ACTIVE) conflict("v${latest.version} is already active in e1, and the profile hasn't changed since")
            }
            val release = if (reusable) latest else ReleaseEntity().apply {
                marketCode = entity.code
                accountType = type
                version = (latest?.version ?: 0) + 1
                configJson = json
                this.checksum = checksum
                author = profile.editedBy ?: actor
                approver = actor
                createdAt = Instant.now()
                persist()
            }
            val deployment = deploy(release, EnvStage.E1, actor)
            revisions.record(
                code = entity.code,
                action = RevisionAction.RELEASED,
                actor = actor,
                summary = "${label(type)} v${release.version} ${if (reusable) "" else "frozen and "}sent to e1",
                envs = listOf(EnvStage.E1),
                profileLabel = label(type),
                beforeJson = latest?.takeIf { it !== release }?.configJson,
                afterJson = release.configJson,
            )
            deployment.id!!
        }
        trySend(id)
    }

    // ---- 4: sign off ----

    /** The sign-off: sent to the environment's workflow, with the RFC in E3 (wiki: `verifyProfile()`). */
    fun verifyProfile(code: String, profileId: String, env: EnvStage, actor: String) {
        val now = Instant.now()
        val ref = tx {
            val (entity, profile) = load(code, profileId)
            val d = newest(entity.code, profile.accountType, env)
                ?: conflict("Nothing has been sent to ${env.label} yet")
            if (d.status != ReleaseStatus.WAITING_FOR_SIGN_OFF) {
                conflict("v${d.version} in ${env.label} isn't waiting for a sign-off: it is ${d.status.phrase}")
            }
            if (env == EnvStage.E3 && d.rfc.isNullOrBlank()) conflict("Record the change request before signing off in e3")
            Ref(d)
        }
        if (!ref.simulated) {
            val client = environments.client(env) ?: conflict("${env.label} has no Market Onboarding API configured")
            guarded(refused(ref, actor, "sign-off of v${ref.version}")) { client.signOff(ref.market, ref.apiType, ref.version, actor, now, ref.rfc) }
        }
        tx {
            val d = DeploymentEntity.findById(ref.id)!!
            d.signedOffBy = actor
            d.signedOffAt = now
            if (d.simulated) {
                d.status = ReleaseStatus.RUNNING
                d.step = ReleaseStep.ACTIVATE
            }
            d.updatedAt = now
            revisions.record(
                code = d.marketCode,
                action = RevisionAction.VERIFIED,
                actor = actor,
                summary = "${label(d.accountType)} v${d.version} signed off in ${env.label}" + (d.rfc?.let { " under $it" } ?: ""),
                envs = listOf(env),
                at = now,
                profileLabel = label(d.accountType),
            )
        }
        refresh(ref.id)
    }

    /**
     * Validates a change request with ServiceNow and records it on the release waiting in E3; an unapproved number is
     * never stored. Required before the E3 sign-off (wiki: `recordRfc()`).
     */
    fun recordRfc(code: String, profileId: String, rfcNumber: String, actor: String) {
        val number = rfcNumber.trim()
        if (number.isBlank()) throw WebApplicationException("Enter a change request number", Response.Status.BAD_REQUEST)
        tx {
            val (entity, profile) = load(code, profileId)
            val d = newest(entity.code, profile.accountType, EnvStage.E3)
                ?: conflict("A change request authorises a release in e3; nothing has been promoted to e3 yet")
            if (!d.status.inFlight || d.signedOffAt != null) {
                conflict("v${d.version} in e3 is ${d.status.phrase}; a change request is only taken before its sign-off")
            }
            val result = serviceNow.validate(number)
            if (!result.valid) throw WebApplicationException(result.message, Response.Status.BAD_REQUEST)
            d.rfc = number
            d.updatedAt = Instant.now()
            revisions.record(
                code = entity.code,
                action = RevisionAction.RFC_RECORDED,
                actor = actor,
                summary = "${label(d.accountType)} v${d.version}: change request $number approved",
                envs = listOf(EnvStage.E3),
                profileLabel = label(d.accountType),
            )
        }
    }

    // ---- 5: promote ----

    /** Sends the version live in [from] to the next environment (wiki: `promote()` sends vN to the next environment). */
    fun promote(code: String, profileId: String, from: EnvStage, actor: String) {
        val id = tx {
            val (entity, profile) = load(code, profileId)
            val to = from.next() ?: conflict("e3 is production; there is nowhere further to promote to")
            val live = live(entity.code, profile.accountType, from)
                ?: conflict("Nothing is active and signed off in ${from.label} yet")
            inFlight(entity.code, profile.accountType, to)?.let {
                conflict("v${it.version} is still ${it.status.phrase} in ${to.label}")
            }
            DeploymentEntity.find(entity.code, profile.accountType, live.version, to)?.let {
                if (it.status != ReleaseStatus.FAILED) conflict("v${live.version} has already been sent to ${to.label}")
                it.delete()
            }
            val release = ReleaseEntity.find(entity.code, profile.accountType, live.version)
                ?: conflict("v${live.version} has no frozen release to send")
            val deployment = deploy(release, to, actor)
            if (to > profile.status) writeProfile(entity) { it.copy(status = to) }
            revisions.record(
                code = entity.code,
                action = RevisionAction.PROMOTED,
                actor = actor,
                summary = "${label(profile.accountType)} v${live.version} promoted from ${from.label} to ${to.label}",
                envs = listOf(to),
                profileLabel = label(profile.accountType),
            )
            deployment.id!!
        }
        trySend(id)
    }

    // ---- rollback, pause and resume ----

    /** Switches [env] back to the version its live release replaced (billpay-core, Proposed: one level). */
    fun rollback(code: String, profileId: String, env: EnvStage, reason: String?, actor: String) {
        val ref = tx {
            val (entity, profile) = load(code, profileId)
            val d = live(entity.code, profile.accountType, env) ?: conflict("Nothing is live in ${env.label}")
            val previous = d.replacedVersion
                ?: conflict("v${d.version} replaced no version in ${env.label}, so there is none to roll back to")
            if (inFlight(entity.code, profile.accountType, env) != null) {
                conflict("Wait for the release under way in ${env.label} before rolling back")
            }
            Ref(d) to previous
        }
        val (d, previous) = ref
        if (!d.simulated) {
            val client = environments.client(env) ?: conflict("${env.label} has no Market Onboarding API configured")
            guarded(refused(d, actor, "rollback of v${d.version}")) { client.rollback(d.market, d.apiType, d.version, actor, reason) }
        }
        tx {
            val row = DeploymentEntity.findById(d.id)!!
            if (row.simulated) {
                row.status = ReleaseStatus.RUNNING
                row.step = ReleaseStep.ROLLBACK
            }
            row.updatedAt = Instant.now()
            revisions.record(
                code = row.marketCode,
                action = RevisionAction.ROLLED_BACK,
                actor = actor,
                summary = "${label(row.accountType)} v${row.version} rolled back to v$previous in ${env.label}" +
                    (reason?.takeIf { it.isNotBlank() }?.let { ": $it" } ?: ""),
                envs = listOf(env),
                profileLabel = label(row.accountType),
            )
        }
        refresh(d.id)
    }

    fun pause(code: String, profileId: String, env: EnvStage, reason: String?, actor: String) = control(code, profileId, env, reason, actor, paused = true)

    fun resume(code: String, profileId: String, env: EnvStage, reason: String?, actor: String) = control(code, profileId, env, reason, actor, paused = false)

    /**
     * Pause or resume: billpay-core pauses the market and account type's Schedules and sets a PAUSE override on the
     * market's EXECUTION rate, so a run already going holds too. That rate's scope is the whole market, so a pause
     * holds every account type's runs in it (billpay-core, Proposed).
     */
    private fun control(code: String, profileId: String, env: EnvStage, reason: String?, actor: String, paused: Boolean) {
        val ref = tx {
            val (entity, profile) = load(code, profileId)
            Ref(live(entity.code, profile.accountType, env) ?: conflict("Nothing is live in ${env.label} to ${if (paused) "pause" else "resume"}"))
        }
        if (!ref.simulated) {
            val client = environments.client(env) ?: conflict("${env.label} has no Market Onboarding API configured")
            guarded(refused(ref, actor, if (paused) "pause" else "resume")) {
                if (paused) client.pause(ref.market, ref.apiType, actor, reason) else client.resume(ref.market, ref.apiType, actor, reason)
            }
        }
        tx {
            MarketControlEntity().apply {
                marketCode = ref.market
                accountType = ref.accountType
                this.env = env
                this.paused = paused
                requestedBy = actor
                this.reason = reason?.takeIf { it.isNotBlank() }?.take(512)
                at = Instant.now()
                persist()
            }
            revisions.record(
                code = ref.market,
                action = if (paused) RevisionAction.PAUSED else RevisionAction.RESUMED,
                actor = actor,
                summary = "${label(ref.accountType)} ${if (paused) "paused" else "resumed"} in ${env.label}" +
                    (reason?.takeIf { it.isNotBlank() }?.let { ": $it" } ?: ""),
                envs = listOf(env),
                profileLabel = label(ref.accountType),
            )
        }
    }

    // ---- 3: track ----

    /** Sends a release the environment hasn't accepted yet. A refusal fails the row; an outage leaves it for a retry. */
    fun trySend(id: Long) {
        val send = tx {
            val d = DeploymentEntity.findById(id) ?: return@tx null
            if (d.sent || d.simulated || d.status != ReleaseStatus.REQUESTED) return@tx null
            val release = ReleaseEntity.find(d.marketCode, d.accountType, d.version) ?: return@tx null
            Triple(Ref(d), release.checksum, release.configJson) to (release.author to release.approver)
        } ?: return
        val (target, people) = send
        val (ref, checksum, json) = target
        val client = environments.client(ref.env) ?: return
        try {
            val accepted = client.send(ref.market, ref.apiType, ref.version, checksum, mapper.readTree(json), people.first, people.second)
            tx {
                DeploymentEntity.findById(id)?.apply {
                    sent = true
                    workflowId = accepted.workflowId
                    lastError = null
                    updatedAt = Instant.now()
                }
            }
            refresh(id)
        } catch (e: OnboardingApiException) {
            tx {
                val d = DeploymentEntity.findById(id) ?: return@tx
                d.updatedAt = Instant.now()
                if (e.status != null && e.status in 400..499 && e.status != 429) {
                    // Refused for good: a bad body, or this version already there with another checksum.
                    d.status = ReleaseStatus.FAILED
                    d.reason = "${ref.env.label} refused the release: ${e.detail}"
                    d.lastError = null
                    outcome(d, RevisionAction.FAILED, "${label(d.accountType)} v${d.version} refused by ${ref.env.label}: ${e.detail}")
                } else {
                    d.lastError = "${e.detail}; sending again"
                }
            }
        }
    }

    /** Reads the release's progress from its environment and records any change. */
    fun refresh(id: Long) {
        val ref = tx { DeploymentEntity.findById(id)?.let(::Ref) } ?: return
        if (ref.simulated) {
            simulate(id)
            return
        }
        if (!ref.sent) {
            trySend(id)
            return
        }
        val client = environments.client(ref.env) ?: return
        val progress = try {
            client.status(ref.market, ref.apiType, ref.version)
        } catch (e: OnboardingApiException) {
            tx { DeploymentEntity.findById(id)?.apply { lastError = e.detail } }
            return
        }
        val changed = tx {
            val d = DeploymentEntity.findById(id) ?: return@tx false
            if (progress == null) {
                d.lastError = "${ref.env.label} has no record of v${d.version}; was its environment reset?"
                return@tx false
            }
            val was = d.status
            val moved = was != progress.status || d.step != progress.step || d.reason != progress.reason ||
                d.replacedVersion != progress.replacedVersion || d.needsBuild != progress.needsBuild
            d.lastError = null
            if (!moved) return@tx false
            d.status = progress.status
            d.step = progress.step
            d.reason = progress.reason
            d.needsBuild = progress.needsBuild
            d.replacedVersion = progress.replacedVersion
            progress.workflowId?.let { d.workflowId = it }
            d.updatedAt = Instant.now()
            if (was != progress.status) {
                when (progress.status) {
                    ReleaseStatus.ACTIVE -> if (was != ReleaseStatus.SUPERSEDED) outcome(d, RevisionAction.ACTIVATED, activated(d))
                    ReleaseStatus.FAILED -> outcome(d, RevisionAction.FAILED, failed(d))
                    else -> Unit
                }
            }
            was != progress.status && progress.status in SETTLING
        }
        // A version going live, or rolling back, changes its neighbours' standing too.
        if (changed) siblings(ref).forEach { refresh(it) }
    }

    /**
     * Walks a simulated release through the workflow's steps on the clock, as billpay-core's MarketOnboardingWorkflow
     * would: check, save, a short test, then the wait for a sign-off; after it, activation and the superseding of the
     * version it replaced; after a rollback, the replaced version live again.
     */
    fun simulate(id: Long) = tx {
        val d = DeploymentEntity.findById(id) ?: return@tx
        val now = Instant.now()
        val since = Duration.between(d.requestedAt, now)
        when {
            d.status == ReleaseStatus.REQUESTED || (d.status == ReleaseStatus.RUNNING && d.step in PREPARING) -> {
                val step = SIMULATED_STEPS.lastOrNull { since >= beat.multipliedBy(it.first) }?.second
                val window = ReleaseEntity.find(d.marketCode, d.accountType, d.version)
                    ?.let { mapper.readTree(it.configJson).get("cancellationWindow")?.asText() }
                    ?.let { runCatching { Duration.parse(it) }.getOrNull() }
                when {
                    step == null -> Unit
                    step == ReleaseStep.SAVE && window != null && !window.isPositive -> {
                        d.status = ReleaseStatus.FAILED
                        d.step = ReleaseStep.CHECK
                        d.reason = "cancellationWindow $window doesn't close before the execution time"
                        d.updatedAt = now
                        outcome(d, RevisionAction.FAILED, failed(d))
                    }
                    step == ReleaseStep.WAIT -> {
                        d.status = ReleaseStatus.WAITING_FOR_SIGN_OFF
                        d.step = ReleaseStep.WAIT
                        d.updatedAt = now
                    }
                    step != d.step -> {
                        d.status = ReleaseStatus.RUNNING
                        d.step = step
                        d.updatedAt = now
                    }
                }
            }
            d.status == ReleaseStatus.RUNNING && d.step == ReleaseStep.ACTIVATE && Duration.between(d.updatedAt, now) >= beat -> {
                val replaced = DeploymentEntity.forProfile(d.marketCode, d.accountType)
                    .firstOrNull { it.env == d.env && it.status == ReleaseStatus.ACTIVE && it.id != d.id }
                replaced?.apply {
                    status = ReleaseStatus.SUPERSEDED
                    reason = "v${d.version} is active now"
                    updatedAt = now
                }
                d.status = ReleaseStatus.ACTIVE
                d.step = null
                d.replacedVersion = replaced?.version
                d.updatedAt = now
                outcome(d, RevisionAction.ACTIVATED, activated(d))
            }
            d.status == ReleaseStatus.RUNNING && d.step == ReleaseStep.ROLLBACK && Duration.between(d.updatedAt, now) >= beat -> {
                DeploymentEntity.forProfile(d.marketCode, d.accountType)
                    .firstOrNull { it.env == d.env && it.version == d.replacedVersion }
                    ?.apply {
                        status = ReleaseStatus.ACTIVE
                        reason = null
                        updatedAt = now
                    }
                d.status = ReleaseStatus.ROLLED_BACK
                d.step = null
                d.updatedAt = now
            }
        }
    }

    /**
     * The other versions in the same environment whose standing a change to [ref] can move: billpay-core reports a
     * replaced version SUPERSEDED, and ACTIVE again after a rollback. A simulated (seeded) row the real environment
     * never knew is superseded here once a later version is live there.
     */
    private fun siblings(ref: Ref): List<Long> = tx {
        val rows = DeploymentEntity.forProfile(ref.market, ref.accountType).filter { it.env == ref.env && it.id != ref.id }
        val self = DeploymentEntity.findById(ref.id)
        if (self?.status == ReleaseStatus.ACTIVE) {
            rows.filter { it.simulated && it.status == ReleaseStatus.ACTIVE && it.version < self.version }.forEach {
                it.status = ReleaseStatus.SUPERSEDED
                it.reason = "v${self.version} is active now"
                it.updatedAt = Instant.now()
            }
        }
        rows.filter { !it.simulated && it.sent && (it.status == ReleaseStatus.ACTIVE || it.status == ReleaseStatus.SUPERSEDED) }.map { it.id!! }
    }

    // ---- seed ----

    /**
     * Demo data: the profile frozen as v1 and live in every environment up to [liveThrough], and waiting for its
     * sign-off in [waitingIn]. Every row is simulated, since no real environment ran it; the tracker never sends one.
     * Joins the caller's transaction.
     */
    fun seed(code: String, profileId: String, liveThrough: EnvStage?, waitingIn: EnvStage? = null, at: Instant) {
        val (entity, profile) = load(code, profileId)
        val json = mapper.writeValueAsString(ReleaseJson.build(profile, mapper))
        val release = ReleaseEntity().apply {
            marketCode = entity.code
            accountType = profile.accountType
            version = 1
            configJson = json
            checksum = ReleaseJson.checksum(json)
            author = "SYSTEM"
            approver = "SYSTEM"
            createdAt = at
            persist()
        }
        val envs = EnvStage.entries.filter { liveThrough != null && it <= liveThrough } + listOfNotNull(waitingIn)
        envs.forEachIndexed { i, env ->
            val live = env != waitingIn
            DeploymentEntity().apply {
                marketCode = entity.code
                accountType = profile.accountType
                version = 1
                this.env = env
                workflowId = workflowId(entity.code, profile.accountType, 1)
                status = if (live) ReleaseStatus.ACTIVE else ReleaseStatus.WAITING_FOR_SIGN_OFF
                step = if (live) null else ReleaseStep.WAIT
                simulated = true
                sent = true
                requestedBy = "SYSTEM"
                requestedAt = at.plus(Duration.ofDays(i.toLong()))
                updatedAt = requestedAt
                if (live) {
                    signedOffBy = "SYSTEM"
                    signedOffAt = requestedAt
                    if (env == EnvStage.E3) rfc = "CHG0030${entity.code.hashCode().mod(900) + 100}"
                }
                persist()
            }
        }
        envs.maxOrNull()?.let { furthest -> writeProfile(entity) { if (it.id == profileId) it.copy(status = furthest) else it } }
    }

    // ---- helpers ----

    private fun deploy(release: ReleaseEntity, env: EnvStage, actor: String): DeploymentEntity {
        val simulated = environments.client(env) == null
        val now = Instant.now()
        return DeploymentEntity().apply {
            marketCode = release.marketCode
            accountType = release.accountType
            version = release.version
            this.env = env
            workflowId = workflowId(release.marketCode, release.accountType, release.version)
            status = ReleaseStatus.REQUESTED
            this.simulated = simulated
            sent = simulated
            requestedBy = actor
            requestedAt = now
            updatedAt = now
            persist()
        }
    }

    private fun outcome(d: DeploymentEntity, action: RevisionAction, summary: String) =
        revisions.record(
            code = d.marketCode,
            action = action,
            actor = "SYSTEM",
            summary = summary,
            envs = listOf(d.env),
            profileLabel = label(d.accountType),
        )

    private fun activated(d: DeploymentEntity) =
        "${label(d.accountType)} v${d.version} active in ${d.env.label}" + (d.replacedVersion?.let { ", replacing v$it" } ?: "")

    private fun failed(d: DeploymentEntity) =
        "${label(d.accountType)} v${d.version} failed at ${d.step?.name?.lowercase() ?: "check"} in ${d.env.label}" +
            (if (d.needsBuild) " (needs a build)" else "") + (d.reason?.let { ": $it" } ?: "")

    private fun newest(code: String, type: AccountType, env: EnvStage): DeploymentEntity? =
        DeploymentEntity.forProfile(code, type).firstOrNull { it.env == env }

    private fun live(code: String, type: AccountType, env: EnvStage): DeploymentEntity? =
        DeploymentEntity.forProfile(code, type).firstOrNull { it.env == env && it.status == ReleaseStatus.ACTIVE }

    private fun inFlight(code: String, type: AccountType, env: EnvStage): DeploymentEntity? =
        DeploymentEntity.forProfile(code, type).firstOrNull { it.env == env && it.status.inFlight }

    private fun load(code: String, profileId: String): Pair<MarketEntity, MarketProfile> {
        val entity = MarketEntity.findByCode(code.uppercase())
            ?: throw WebApplicationException("Market '$code' not found", Response.Status.NOT_FOUND)
        val profile = MarketConfigs.read(mapper, entity.configJson).profiles.find { it.id == profileId }
            ?: throw WebApplicationException("Profile '$profileId' not found in market '$code'", Response.Status.NOT_FOUND)
        return entity to profile
    }

    private fun writeProfile(entity: MarketEntity, change: (MarketProfile) -> MarketProfile) {
        val config: MarketConfig = MarketConfigs.read(mapper, entity.configJson)
        entity.configJson = MarketConfigs.write(mapper, config.copy(profiles = config.profiles.map(change)))
        entity.updatedAt = Instant.now()
    }

    /**
     * An environment's refusal or outage, as the UI should hear it. [onRefusal] hears it first, so a refused action
     * leaves an audit row as well as an error.
     */
    private fun <T> guarded(onRefusal: (OnboardingApiException) -> Unit = {}, call: () -> T): T = try {
        call()
    } catch (e: OnboardingApiException) {
        runCatching { onRefusal(e) }
        val status = when (e.status) {
            null -> Response.Status.BAD_GATEWAY
            404 -> Response.Status.NOT_FOUND
            409 -> Response.Status.CONFLICT
            503 -> Response.Status.SERVICE_UNAVAILABLE
            in 400..499 -> Response.Status.BAD_REQUEST
            else -> Response.Status.BAD_GATEWAY
        }
        throw WebApplicationException(e.detail, status)
    }

    /** Records an action the environment refused (a 4xx), so the history holds attempts as well as outcomes. */
    private fun refused(ref: Ref, actor: String, what: String): (OnboardingApiException) -> Unit = { e ->
        if (e.status != null && e.status in 400..499) {
            tx {
                revisions.record(
                    code = ref.market,
                    action = RevisionAction.REFUSED,
                    actor = actor,
                    summary = "${label(ref.accountType)} $what refused by ${ref.env.label}: ${e.detail}",
                    envs = listOf(ref.env),
                    profileLabel = label(ref.accountType),
                )
            }
        }
    }

    private fun <T> tx(block: () -> T): T = QuarkusTransaction.requiringNew().call<T> { block() }

    private fun conflict(message: String): Nothing = throw WebApplicationException(message, Response.Status.CONFLICT)

    private fun label(type: AccountType) = RevisionSummary.accountTypeLabel(type)

    /** What the calls outside a transaction need of a deployment row. */
    private data class Ref(
        val id: Long,
        val market: String,
        val accountType: AccountType,
        val version: Int,
        val env: EnvStage,
        val simulated: Boolean,
        val sent: Boolean,
        val rfc: String?,
    ) {
        constructor(d: DeploymentEntity) : this(d.id!!, d.marketCode, d.accountType, d.version, d.env, d.simulated, d.sent, d.rfc)

        val apiType: String get() = accountType.apiName
    }

    companion object {
        /** billpay-core's workflow ID for a release (spec: `onboard-{market}-{accountType}-v{N}`). */
        fun workflowId(market: String, type: AccountType, version: Int) = "onboard-$market-${type.apiName}-v$version"

        private val PREPARING = setOf(ReleaseStep.CHECK, ReleaseStep.SAVE, ReleaseStep.TEST)

        /** A simulated release's steps on the clock, in beats from when it was sent; activation and rollback take one. */
        private val SIMULATED_STEPS = listOf(
            1L to ReleaseStep.CHECK,
            3L to ReleaseStep.SAVE,
            4L to ReleaseStep.TEST,
            8L to ReleaseStep.WAIT,
        )

        /** Statuses after which the release's neighbours in the environment are read again. */
        private val SETTLING = setOf(ReleaseStatus.ACTIVE, ReleaseStatus.ROLLED_BACK)

        private val EnvStage.label: String get() = name.lowercase()

        private val ReleaseStatus.phrase: String
            get() = when (this) {
                ReleaseStatus.REQUESTED -> "requested"
                ReleaseStatus.RUNNING -> "running"
                ReleaseStatus.WAITING_FOR_SIGN_OFF -> "waiting for its sign-off"
                ReleaseStatus.ACTIVE -> "active"
                ReleaseStatus.FAILED -> "failed"
                ReleaseStatus.ROLLED_BACK -> "rolled back"
                ReleaseStatus.SUPERSEDED -> "superseded"
            }
    }
}
