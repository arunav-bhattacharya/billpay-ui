import { AppProvider } from './AppContext'
import { Masthead } from './components'
import { Ledger } from './pages/Ledger'

export default function App() {
  return (
    <AppProvider>
      <Masthead />
      <Ledger />
      <footer className="footer">
        <span>Billpay · Market Onboarding</span>
        <span className="mono-tag">One-Data platform · internal tool</span>
      </footer>
    </AppProvider>
  )
}
