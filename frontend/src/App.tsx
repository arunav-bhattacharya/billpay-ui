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
      </footer>
    </AppProvider>
  )
}
