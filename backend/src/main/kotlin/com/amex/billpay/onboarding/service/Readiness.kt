package com.amex.billpay.onboarding.service

import com.amex.billpay.onboarding.catalog.Catalog
import com.amex.billpay.onboarding.entity.DeploymentEntity
import com.amex.billpay.onboarding.entity.MarketControlEntity
import com.amex.billpay.onboarding.model.ControlView
import com.amex.billpay.onboarding.model.DeploymentView
import com.amex.billpay.onboarding.model.EnvMode
import com.amex.billpay.onboarding.model.EnvOnboardingState
import com.amex.billpay.onboarding.model.EnvReadiness
import com.amex.billpay.onboarding.model.EnvStage
import com.amex.billpay.onboarding.model.MarketProfile
import com.amex.billpay.onboarding.model.ProfileReadiness
import com.amex.billpay.onboarding.model.ReadinessStep
import com.amex.billpay.onboarding.model.ReleaseStatus
import com.amex.billpay.onboarding.model.ReleaseStep
import com.amex.billpay.onboarding.model.StepState

/**
 * A profile's standing in each environment, read from its deployment rows (wiki, "From draft to live", step 3: the
 * readiness screen reads the rows). Nothing here is persisted: it is a projection of what the environments reported.
 */
object Readiness {

    fun forProfile(
        profile: MarketProfile,
        deployments: List<DeploymentEntity>,
        controls: Map<EnvStage, MarketControlEntity?>,
        modes: (EnvStage) -> EnvMode,
        latestVersion: Int?,
        draftChanged: Boolean,
    ): ProfileReadiness {
        val environments = EnvStage.entries.map { env ->
            val rows = deployments.filter { it.env == env }.sortedByDescending { it.version }.map(::view)
            forEnv(env, modes(env), rows, controls[env])
        }
        return ProfileReadiness(
            profileId = profile.id,
            accountType = profile.accountType,
            latestVersion = latestVersion,
            draftChanged = draftChanged,
            liveIn = environments.lastOrNull { it.live != null }?.env,
            environments = environments,
        )
    }

    private fun forEnv(env: EnvStage, mode: EnvMode, rows: List<DeploymentView>, control: MarketControlEntity?): EnvReadiness {
        val current = rows.firstOrNull()
        val live = rows.firstOrNull { it.status == ReleaseStatus.ACTIVE }
        val state = when {
            current == null -> EnvOnboardingState.NOT_CONFIGURED
            current.status.inFlight -> EnvOnboardingState.ONBOARDING_IN_PROGRESS
            current.status == ReleaseStatus.FAILED -> EnvOnboardingState.FAILED
            live != null -> EnvOnboardingState.ONBOARDED
            else -> EnvOnboardingState.FAILED
        }
        return EnvReadiness(
            env = env,
            mode = mode,
            state = state,
            current = current,
            live = live,
            steps = current?.let { steps(env, it) }.orEmpty(),
            history = rows,
            control = control?.takeIf { live != null }?.let { ControlView(it.env, it.paused, it.requestedBy, it.reason, it.at) },
        )
    }

    /** The workflow's steps for one deployment, with E3's RFC ahead of its sign-off. */
    fun steps(env: EnvStage, d: DeploymentView): List<ReadinessStep> {
        val defs = Catalog.workflowSteps.filter { it.first != Catalog.STEP_RFC || env == EnvStage.E3 }
        val keys = defs.map { it.first }
        val waitAt = keys.indexOf(ReleaseStep.WAIT.name)
        // Where the workflow is: the index of the step under way, or past the end once it has activated.
        val at = when (d.status) {
            ReleaseStatus.REQUESTED -> 0
            ReleaseStatus.WAITING_FOR_SIGN_OFF -> waitAt
            ReleaseStatus.RUNNING -> d.step?.let { s -> keys.indexOf(s.name).takeIf { it >= 0 } } ?: keys.size
            ReleaseStatus.FAILED -> d.step?.let { s -> keys.indexOf(s.name).takeIf { it >= 0 } } ?: 0
            ReleaseStatus.ACTIVE, ReleaseStatus.ROLLED_BACK, ReleaseStatus.SUPERSEDED -> keys.size
        }
        return defs.mapIndexed { i, (key, name, description) ->
            val state = when {
                key == Catalog.STEP_RFC -> when {
                    d.rfc != null || at > waitAt -> StepState.COMPLETE
                    d.status == ReleaseStatus.FAILED -> StepState.PENDING
                    else -> StepState.IN_PROGRESS
                }
                i < at -> StepState.COMPLETE
                i == at && d.status == ReleaseStatus.FAILED -> StepState.FAILED
                i == at -> StepState.IN_PROGRESS
                else -> StepState.PENDING
            }
            ReadinessStep(key, name, description, state)
        }
    }

    fun view(d: DeploymentEntity) = DeploymentView(
        version = d.version,
        env = d.env,
        workflowId = d.workflowId,
        status = d.status,
        step = d.step,
        reason = d.reason,
        needsBuild = d.needsBuild,
        replacedVersion = d.replacedVersion,
        simulated = d.simulated,
        requestedBy = d.requestedBy,
        requestedAt = d.requestedAt,
        updatedAt = d.updatedAt,
        signedOffBy = d.signedOffBy,
        signedOffAt = d.signedOffAt,
        rfc = d.rfc,
        lastError = d.lastError,
    )
}
