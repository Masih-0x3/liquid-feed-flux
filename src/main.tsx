import { Sentry } from './instrument.ts'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<div className="min-h-screen bg-background p-6 text-foreground">XOT hit a rendering error. Refresh to retry.</div>}>
    <App />
  </Sentry.ErrorBoundary>,
);
