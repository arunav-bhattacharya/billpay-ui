package com.amex.billpay.onboarding.entity

import io.quarkus.hibernate.orm.panache.kotlin.PanacheCompanion
import io.quarkus.hibernate.orm.panache.kotlin.PanacheEntity
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Lob
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "markets")
class MarketEntity : PanacheEntity() {

    companion object : PanacheCompanion<MarketEntity> {
        fun findByCode(code: String): MarketEntity? = find("code", code).firstResult()
    }

    @Column(unique = true, nullable = false, length = 8)
    lateinit var code: String

    @Column(nullable = false)
    lateinit var name: String

    @Column(nullable = false, length = 8)
    lateinit var currency: String

    @Column(nullable = false, length = 16)
    lateinit var region: String

    /** JSON document holding customDimensionDefs + profiles. */
    @Lob
    @Column(name = "config_json", nullable = false)
    lateinit var configJson: String

    @Column(name = "created_at", nullable = false)
    lateinit var createdAt: Instant

    @Column(name = "updated_at", nullable = false)
    lateinit var updatedAt: Instant
}
