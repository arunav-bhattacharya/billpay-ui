import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppProvider } from './AppContext'
import { Masthead } from './components'
import { Ledger } from './pages/Ledger'
import { MarketPage } from './pages/MarketPage'
import { OnboardingPage } from './pages/OnboardingPage'

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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <footer className="footer">
        <span className="footer-mark">Billpay · Market Onboarding</span>
        <span className="footer-legal">© American Express · Billpay 2026</span>
      </footer>
    </AppProvider>
  )
}
