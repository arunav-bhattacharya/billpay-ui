package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.catalog.Catalog
import com.amex.billpay.onboarding.model.ApiVerification
import com.amex.billpay.onboarding.model.EnvOnboardingState
import com.amex.billpay.onboarding.model.EnvReadiness
import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.MarketProfile
import com.amex.billpay.onboarding.model.ProfileReadiness
import com.amex.billpay.onboarding.model.ReadinessStep
import com.amex.billpay.onboarding.model.StepState
import java.time.Duration
import java.time.Instant

/**
 * Environment readiness, derived from how far a profile has been promoted.
 *
 * Nothing here is persisted: readiness is a read-time projection of
 * [MarketProfile.status], so it cannot drift from the promotion state and is
 * identical on every request. Timestamps hang off the market's creation instant
 * rather than the clock for the same reason.
 */
object Readiness {

    fun forProfiles(profiles: List<MarketProfile>, createdAt: Instant?): List<ProfileReadiness> =
        profiles.map { profile ->
            ProfileReadiness(
                profileId = profile.id,
                accountType = profile.accountType,
                environments = EnvStage.entries.map { env -> forEnv(env, profile, createdAt) },
            )
        }

    private fun forEnv(env: EnvStage, profile: MarketProfile, createdAt: Instant?): EnvReadiness {
        val steps = stepsFor(env, profile)
        return EnvReadiness(
            env = env,
            // The status is the steps: nothing to do, part done, or all done.
            state = when {
                steps.isEmpty() -> EnvOnboardingState.NOT_CONFIGURED
                steps.all { it.state == StepState.COMPLETE } -> EnvOnboardingState.ONBOARDED
                else -> EnvOnboardingState.ONBOARDING_IN_PROGRESS
            },
            completedAt = if (steps.isEmpty()) null else completionOf(env, createdAt),
            steps = steps,
        )
    }

    /** Signed off in the environment it currently occupies, and so promotable out of it. */
    fun isSignedOff(profile: MarketProfile): Boolean = profile.verifiedIn == profile.status

    private fun hasRfc(profile: MarketProfile): Boolean = !profile.rfcNumber.isNullOrBlank()

    private fun stepsFor(env: EnvStage, profile: MarketProfile): List<ReadinessStep> {
        val reached = profile.status
        // Environments the profile has not been deployed into have no steps at
        // all, which is what "not configured" means.
        if (env.ordinal > reached.ordinal) return emptyList()

        // Being promoted out of an environment is the proof it finished; the
        // one a profile still sits in is finished by its own sign-off.
        val finished = env.ordinal < reached.ordinal

        return stepsIn(env).map { (key, name, description) ->
            ReadinessStep(
                key = key,
                name = name,
                description = description,
                state = if (finished) StepState.COMPLETE else currentState(key, profile),
                apis = if (key == Catalog.STEP_VERIFY_PROFILES) verifications(profile) else emptyList(),
            )
        }
    }

    /** Where each step stands in the environment the profile currently occupies. */
    private fun currentState(key: String, profile: MarketProfile): StepState = when (key) {
        // Nothing goes into production ahead of the change request that
        // authorises it, so the market profile queues behind it.
        Catalog.STEP_RFC -> if (hasRfc(profile)) StepState.COMPLETE else StepState.IN_PROGRESS
        Catalog.STEP_MARKET_PROFILE ->
            if (profile.status == EnvStage.E3 && !hasRfc(profile)) StepState.PENDING
            else StepState.COMPLETE
        // Sign-off is the one step a person closes, and the only one still
        // open in an environment that has otherwise finished its work.
        Catalog.STEP_SIGN_OFF ->
            if (isSignedOff(profile)) StepState.COMPLETE else StepState.IN_PROGRESS
        // Everything else — including verification — is machine work that is
        // done by the time the profile is in the environment at all.
        else -> StepState.COMPLETE
    }

    /**
     * Production takes a change request and the market profile configuration.
     * Test profiles and API verification are exercised in the environments
     * below it — they are never run against live. Every environment ends with
     * sign-off.
     */
    private fun stepsIn(env: EnvStage): List<Triple<String, String, String>> {
        val work = if (env == EnvStage.E3) {
            listOf(Catalog.rfcStep) +
                Catalog.readinessSteps.filter { it.first == Catalog.STEP_MARKET_PROFILE }
        } else {
            Catalog.readinessSteps
        }
        return work + Catalog.signOffStep
    }

    /** The verify step is complete wherever it renders, so its APIs read clean. */
    private fun verifications(profile: MarketProfile): List<ApiVerification> =
        Catalog.apis.filter { it.name in profile.apis }.map {
            ApiVerification(name = it.name, title = it.title, verified = true)
        }

    /** Each environment reads as completed a day apart, oldest first. */
    private fun completionOf(env: EnvStage, createdAt: Instant?): Instant? =
        createdAt?.plus(Duration.ofDays(env.ordinal.toLong()))
}
