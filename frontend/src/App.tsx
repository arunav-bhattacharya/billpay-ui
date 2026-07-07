import { useEffect, useState } from 'react'
import { AppProvider } from './AppContext'
import { Masthead } from './components'
import { Dashboard } from './pages/Dashboard'
import { MarketDetail } from './pages/MarketDetail'
import { Onboarding } from './pages/Onboarding'

type Route =
  | { name: 'dashboard' }
  | { name: 'onboard'; market: string | null }
  | { name: 'market'; code: string }

function parseHash(hash: string): Route {
  const [path, query] = hash.replace(/^#/, '').split('?')
  const params = new URLSearchParams(query ?? '')
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'onboard') return { name: 'onboard', market: params.get('market') }
  if (parts[0] === 'market' && parts[1]) return { name: 'market', code: parts[1].toUpperCase() }
  return { name: 'dashboard' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <AppProvider>
      <Masthead route={route.name} />
      {route.name === 'dashboard' && <Dashboard />}
      {route.name === 'onboard' && (
        <Onboarding key={route.market ?? 'new'} presetMarket={route.market} />
      )}
      {route.name === 'market' && <MarketDetail key={route.code} code={route.code} />}
      <footer className="footer">
        <span>Billpay · Market Onboarding</span>
        <span className="mono-tag">One-Data platform · internal tool</span>
      </footer>
    </AppProvider>
  )
}
