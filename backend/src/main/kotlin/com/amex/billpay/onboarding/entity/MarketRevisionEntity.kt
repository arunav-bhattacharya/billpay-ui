package com.amex.billpay.onboarding.entity

import com.amex.billpay.onboarding.model.RevisionAction
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
import java.time.Instant

/**
 * An append-only record of every change made to a market.
 *
 * Rows are keyed by market code rather than by foreign key: markets are stored
 * as opaque JSON documents and a revision has to survive being read after its
 * market row was rewritten. Deleting a market deletes its revisions.
 */
@Entity
@Table(
    name = "market_revisions",
    indexes = [Index(name = "idx_revision_market", columnList = "market_code")],
)
class MarketRevisionEntity : PanacheEntity() {

    companion object : PanacheCompanion<MarketRevisionEntity> {
        fun findByMarket(code: String): List<MarketRevisionEntity> =
            list("marketCode", Sort.by("at").descending().and("id", Sort.Direction.Descending), code)

        fun countForMarket(code: String): Long = count("marketCode", code)

        fun deleteForMarket(code: String): Long = delete("marketCode", code)

        /** Rows written before the history was split by environment. */
        fun findWithoutEnvs(): List<MarketRevisionEntity> = list("envs is null")
    }

    @Column(name = "market_code", nullable = false, length = 8)
    lateinit var marketCode: String

    /**
     * Spelled out as varchar rather than left to the dialect: H2 would map the
     * enum to a native `ENUM(...)` fixed to the values present the day the
     * table was created, and schema update never revisits it — so adding an
     * action would break writes on every existing database. The Kotlin enum is
     * the authority on what is valid.
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32, columnDefinition = "varchar(32)")
    lateinit var action: RevisionAction

    /** UI role at the time of the change — the app has no authentication. */
    @Column(nullable = false, length = 16)
    lateinit var actor: String

    @Column(nullable = false, length = 1024)
    lateinit var summary: String

    /**
     * Comma-joined [com.amex.billpay.onboarding.model.EnvStage] names — the
     * environments this change landed in. Nullable so the column can be added
     * to a table that already has rows; those rows are filled in at boot by
     * [com.amex.billpay.onboarding.service.MarketService.backfillRevisions].
     */
    @Column(name = "envs", length = 16)
    var envs: String? = null

    /** Which account-type profile the change landed on, when it was just one. */
    @Column(name = "profile_label", length = 64)
    var profileLabel: String? = null

    @Lob
    @Column(name = "before_json")
    var beforeJson: String? = null

    @Lob
    @Column(name = "after_json")
    var afterJson: String? = null

    @Column(name = "at", nullable = false)
    lateinit var at: Instant
}
