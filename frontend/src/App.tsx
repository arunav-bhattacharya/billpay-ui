import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppProvider } from './AppContext'
import { Masthead } from './components'
import { BuildPage } from './pages/BuildPage'
import { Ledger } from './pages/Ledger'
import { MarketPage } from './pages/MarketPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { RunsPage } from './pages/RunsPage'
import { VersionsPage } from './pages/VersionsPage'

/**
 * A new page starts at the top. The router preserves scroll offset across
 * navigations, so opening a market from halfway down the ledger would
 * otherwise drop you halfway down the market.
 */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <AppProvider>
      <ScrollToTop />
      <Masthead />
      <Routes>
        <Route path="/" element={<Ledger />} />
        <Route path="/markets/:code" element={<MarketPage />} />
        <Route path="/onboard" element={<OnboardingPage />} />
        <Route path="/onboard/:code" element={<OnboardingPage />} />
        <Route path="/versions" element={<VersionsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/build" element={<BuildPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <footer className="footer">
        <span className="footer-mark">Billpay · Market Onboarding</span>
      </footer>
    </AppProvider>
  )
}
