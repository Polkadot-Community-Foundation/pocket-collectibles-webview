import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './styles.css'
import { installDiagnostics } from './diag'

installDiagnostics()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found in index.html')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
