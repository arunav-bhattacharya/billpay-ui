package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.entity.DeploymentEntity
import com.amex.billpay.onboarding.model.ReleaseStatus
import io.quarkus.logging.Log
import io.quarkus.narayana.jta.QuarkusTransaction
import io.quarkus.scheduler.Scheduled
import jakarta.enterprise.context.ApplicationScoped
import java.util.concurrent.atomic.AtomicLong

/**
 * Follows every deployment row whose workflow can still move (wiki, "From draft to live", step 3). Each tick sends
 * what an environment hasn't accepted yet, reads in-flight releases, and walks simulated ones through their steps. An
 * active release only changes when a later version or a rollback moves it, both of which refresh it at once, so the
 * tracker reads it only every [ACTIVE_EVERY] ticks, to catch a change made outside this app.
 */
@ApplicationScoped
class DeploymentTracker(private val releases: ReleaseService) {

    private val ticks = AtomicLong()

    @Scheduled(every = "{billpay.tracker.every}", concurrentExecution = Scheduled.ConcurrentExecution.SKIP, delayed = "2s")
    fun tick() {
        val tick = ticks.incrementAndGet()
        val rows = QuarkusTransaction.requiringNew().call {
            DeploymentEntity.tracked().map { it.id!! to it.status }
        }
        rows.forEach { (id, status) ->
            if (status != ReleaseStatus.ACTIVE || tick % ACTIVE_EVERY == 0L) {
                try {
                    releases.refresh(id)
                } catch (e: Exception) {
                    Log.warnf(e, "Couldn't refresh deployment %d", id)
                }
            }
        }
    }

    private companion object {
        const val ACTIVE_EVERY = 10L
    }
}
