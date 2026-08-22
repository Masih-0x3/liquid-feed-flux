import { AppErrorBoundary } from './components/errors/AppErrorBoundary.tsx'
import { initializeSentry } from './instrument.ts'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

void initializeSentry();
