import { useNavigate, useParams } from 'react-router-dom'
import { OnboardingPanel } from './OnboardingPanel'

/**
 * The wizard on its own route. `/onboard/:code` presets the market, which is
 * how the map and a market's "+ Account Profile" both arrive here.
 */
export function OnboardingPage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const preset = code?.toUpperCase() ?? null

  return (
    <main className="page">
      <OnboardingPanel
        key={preset ?? 'new'}
        presetMarket={preset}
        onClose={() => navigate('/')}
        onDone={(market) => navigate(`/markets/${market}`)}
      />
    </main>
  )
}
