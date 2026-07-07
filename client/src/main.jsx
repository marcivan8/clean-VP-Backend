import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
// Must be imported before App so i18next is initialised before any
// component calls useTranslation(). Without this the landing page renders
// blank because t() returns undefined for every key.
import './i18n.js'
import App from './App.jsx'

// DSN is public by design — safe to hardcode as fallback.
// Override with VITE_SENTRY_DSN env var if you need per-environment DSNs.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
    || 'https://66ba855e2d7f62590fd851422775cb0d@o4511559864680448.ingest.de.sentry.io/4511559872151632';

if (SENTRY_DSN) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE,           // 'development' | 'production'
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration({
                maskAllText: false,
                blockAllMedia: false,
            }),
        ],
        // 10 % of transactions captured for performance monitoring.
        // 100 % of sessions that had an error get a replay.
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.05,
        replaysOnErrorSampleRate: 1.0,
    });
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <App />
    </StrictMode>,
)
