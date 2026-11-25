package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.entity.MarketRevisionEntity
import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.MarketRevision
import com.amex.billpay.onboarding.model.RevisionAction
import jakarta.enterprise.context.ApplicationScoped
import java.time.Instant

/**
 * The market's append-only history. There is no authentication: the caller passes the UI role through, so the history
 * says who was acting rather than attributing everything to one anonymous user. Each row names the environments it
 * landed in, so each environment keeps a history of its own.
 */
@ApplicationScoped
class RevisionLog {

    fun record(
        code: String,
        action: RevisionAction,
        actor: String,
        summary: String,
        envs: List<EnvStage>,
        at: Instant = Instant.now(),
        profileLabel: String? = null,
        beforeJson: String? = null,
        afterJson: String? = null,
    ) {
        MarketRevisionEntity().apply {
            this.marketCode = code
            this.action = action
            this.actor = actor.ifBlank { "OPERATOR" }.uppercase().take(16)
            this.summary = summary.take(1024)
            this.envs = write(envs)
            this.profileLabel = profileLabel
            this.beforeJson = beforeJson
            this.afterJson = afterJson
            this.at = at
        }.persist()
    }

    fun forMarket(code: String): List<MarketRevision> =
        MarketRevisionEntity.findByMarket(code).map {
            MarketRevision(
                id = it.id ?: 0,
                action = it.action,
                actor = it.actor,
                summary = it.summary,
                envs = read(it.envs),
                profileLabel = it.profileLabel,
                beforeJson = it.beforeJson,
                afterJson = it.afterJson,
                at = it.at,
            )
        }

    fun write(envs: List<EnvStage>): String? = envs.distinct().sorted().takeIf { it.isNotEmpty() }?.joinToString(",") { it.name }

    private fun read(raw: String?): List<EnvStage> =
        raw?.split(",").orEmpty().filter { it.isNotBlank() }.map { EnvStage.valueOf(it) }
}
