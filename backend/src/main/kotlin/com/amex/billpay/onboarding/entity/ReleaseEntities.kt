package com.amex.billpay.onboarding.entity

import com.amex.billpay.onboarding.model.AccountType
import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.ReleaseStatus
import com.amex.billpay.onboarding.model.ReleaseStep
import io.quarkus.hibernate.orm.panache.kotlin.PanacheCompanion
import io.quarkus.hibernate.orm.panache.kotlin.PanacheEntity
import io.quarkus.panache.common.Sort
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Index
import jakarta.persistence.Lob
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import java.time.Instant

/*
 * Enums are spelled out as varchar rather than left to the dialect: H2 would map them to a native ENUM fixed to the
 * values present the day the table was created, and schema update never revisits it.
 */

/**
 * A frozen release (wiki, "From draft to live", step 1): one profile at one version, never changed. Later edits
 * become the next version.
 */
@Entity
@Table(
    name = "releases",
    uniqueConstraints = [UniqueConstraint(name = "uq_release", columnNames = ["market_code", "account_type", "version"])],
)
class ReleaseEntity : PanacheEntity() {

    companion object : PanacheCompanion<ReleaseEntity> {
        fun forProfile(market: String, accountType: AccountType): List<ReleaseEntity> =
            list("marketCode = ?1 and accountType = ?2", Sort.descending("version"), market, accountType)

        fun find(market: String, accountType: AccountType, version: Int): ReleaseEntity? =
            find("marketCode = ?1 and accountType = ?2 and version = ?3", market, accountType, version).firstResult()

        fun deleteForMarket(market: String): Long = delete("marketCode", market)

        fun deleteForProfile(market: String, accountType: AccountType): Long =
            delete("marketCode = ?1 and accountType = ?2", market, accountType)
    }

    @Column(name = "market_code", nullable = false, length = 8)
    lateinit var marketCode: String

    @Enumerated(EnumType.STRING)
    @Column(name = "account_type", nullable = false, length = 32, columnDefinition = "varchar(32)")
    lateinit var accountType: AccountType

    @Column(nullable = false)
    var version: Int = 0

    /** The release JSON, as billpay-core's Router reads it from MARKET_CONFIG_VERSION.CONFIG_DA. */
    @Lob
    @Column(name = "config_json", nullable = false)
    lateinit var configJson: String

    /** `sha256:` and the hex digest of [configJson]. */
    @Column(nullable = false, length = 80)
    lateinit var checksum: String

    @Column(length = 64)
    var author: String? = null

    @Column(length = 64)
    var approver: String? = null

    @Column(name = "created_at", nullable = false)
    lateinit var createdAt: Instant
}

/**
 * A deployment row per release and environment (wiki, "From draft to live", step 3): it follows the release's
 * MarketOnboardingWorkflow there, and the readiness screen reads it.
 */
@Entity
@Table(
    name = "deployments",
    uniqueConstraints = [UniqueConstraint(name = "uq_deployment", columnNames = ["market_code", "account_type", "version", "env"])],
    indexes = [Index(name = "idx_deployment_status", columnList = "status")],
)
class DeploymentEntity : PanacheEntity() {

    companion object : PanacheCompanion<DeploymentEntity> {
        fun forProfile(market: String, accountType: AccountType): List<DeploymentEntity> =
            list("marketCode = ?1 and accountType = ?2", Sort.descending("version"), market, accountType)

        fun forMarket(market: String): List<DeploymentEntity> = list("marketCode", market)

        fun find(market: String, accountType: AccountType, version: Int, env: EnvStage): DeploymentEntity? =
            find(
                "marketCode = ?1 and accountType = ?2 and version = ?3 and env = ?4",
                market, accountType, version, env,
            ).firstResult()

        /** Rows whose workflow can still move: in flight, or active and so open to a rollback or a successor. */
        fun tracked(): List<DeploymentEntity> =
            list(
                "status in ?1",
                listOf(ReleaseStatus.REQUESTED, ReleaseStatus.RUNNING, ReleaseStatus.WAITING_FOR_SIGN_OFF, ReleaseStatus.ACTIVE),
            )

        fun deleteForMarket(market: String): Long = delete("marketCode", market)

        fun deleteForProfile(market: String, accountType: AccountType): Long =
            delete("marketCode = ?1 and accountType = ?2", market, accountType)
    }

    @Column(name = "market_code", nullable = false, length = 8)
    lateinit var marketCode: String

    @Enumerated(EnumType.STRING)
    @Column(name = "account_type", nullable = false, length = 32, columnDefinition = "varchar(32)")
    lateinit var accountType: AccountType

    @Column(nullable = false)
    var version: Int = 0

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 4, columnDefinition = "varchar(4)")
    lateinit var env: EnvStage

    @Column(name = "workflow_id", length = 96)
    var workflowId: String? = null

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32, columnDefinition = "varchar(32)")
    lateinit var status: ReleaseStatus

    @Enumerated(EnumType.STRING)
    @Column(length = 16, columnDefinition = "varchar(16)")
    var step: ReleaseStep? = null

    @Column(length = 2048)
    var reason: String? = null

    @Column(name = "needs_build", nullable = false)
    var needsBuild: Boolean = false

    @Column(name = "replaced_version")
    var replacedVersion: Int? = null

    /** Walked through its steps by billpay-ui itself, since the environment has no API configured. */
    @Column(nullable = false)
    var simulated: Boolean = false

    /**
     * The environment has accepted the release (its 202). Until then the tracker sends it again: sending is
     * idempotent, one workflow per market, account type, version and environment.
     */
    @Column(nullable = false)
    var sent: Boolean = false

    @Column(name = "requested_by", length = 64)
    var requestedBy: String? = null

    @Column(name = "requested_at", nullable = false)
    lateinit var requestedAt: Instant

    @Column(name = "updated_at", nullable = false)
    lateinit var updatedAt: Instant

    @Column(name = "signed_off_by", length = 64)
    var signedOffBy: String? = null

    @Column(name = "signed_off_at")
    var signedOffAt: Instant? = null

    /** The ServiceNow change request an E3 sign-off carries. */
    @Column(length = 32)
    var rfc: String? = null

    @Column(name = "last_error", length = 1024)
    var lastError: String? = null
}

/**
 * One pause or resume of a live market and account type in one environment: the newest row is its state, and the rows
 * together are the audit trail. billpay-core's API reports no pause state, so billpay-ui keeps its own.
 */
@Entity
@Table(name = "market_controls", indexes = [Index(name = "idx_control_profile", columnList = "market_code,account_type,env")])
class MarketControlEntity : PanacheEntity() {

    companion object : PanacheCompanion<MarketControlEntity> {
        fun latest(market: String, accountType: AccountType, env: EnvStage): MarketControlEntity? =
            find(
                "marketCode = ?1 and accountType = ?2 and env = ?3",
                Sort.descending("at").and("id", Sort.Direction.Descending),
                market, accountType, env,
            ).firstResult()

        fun deleteForMarket(market: String): Long = delete("marketCode", market)

        fun deleteForProfile(market: String, accountType: AccountType): Long =
            delete("marketCode = ?1 and accountType = ?2", market, accountType)
    }

    @Column(name = "market_code", nullable = false, length = 8)
    lateinit var marketCode: String

    @Enumerated(EnumType.STRING)
    @Column(name = "account_type", nullable = false, length = 32, columnDefinition = "varchar(32)")
    lateinit var accountType: AccountType

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 4, columnDefinition = "varchar(4)")
    lateinit var env: EnvStage

    @Column(nullable = false)
    var paused: Boolean = false

    @Column(name = "requested_by", nullable = false, length = 64)
    lateinit var requestedBy: String

    @Column(length = 512)
    var reason: String? = null

    @Column(nullable = false)
    lateinit var at: Instant
}
