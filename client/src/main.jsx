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
        // Known-noisy, non-actionable errors that originate OUTSIDE Vibed's own
        // code — filtered here rather than left to alert-fatigue the Sentry feed.
        ignoreErrors: [
            // @supabase/auth-js's cross-tab session lock (navigator.locks)
            // constructs a `LockAcquireTimeoutError` when the lock can't be
            // acquired in time — `class ... extends Error { constructor(e) {
            // super(e); this.isAcquireTimeout = true; } }`. In a normal
            // browser that just makes a LockAcquireTimeoutError. Traced one
            // instance of this via the client bundle's sourcemap back to
            // exactly that file (node_modules/@supabase/auth-js/dist/module/
            // lib/locks.js) — the surrounding app code (client/src/lib/
            // supabaseClient.js) doesn't touch navigator.locks or Error
            // itself at all, so there's nothing here for Vibed's own code to
            // have gotten wrong.
            //
            // The TypeError specifically ("Cannot add property
            // isAcquireTimeout, object is not extensible" / Firefox's "can't
            // define property ... is not extensible") means `super(e)`
            // itself returned an object that was ALREADY non-extensible
            // before that assignment ran — i.e. something in that browser
            // tab had frozen/sealed Error (or its prototype) before
            // auth-js's lock code ever got a chance to run. That's a known
            // side effect of "SES lockdown" hardening that several crypto
            // wallet extensions (MetaMask, Phantom, Rabby, …) inject into
            // every page for their own security sandboxing — not something
            // a page's own script can prevent or catch upstream of. No
            // report of the editor actually breaking for a real user has
            // come with this alert; it's page-load noise from whichever
            // wallet extension a visitor happens to have enabled.
            /Cannot add property isAcquireTimeout/,
            /can't define property "isAcquireTimeout"/,
        ],
    });
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <App />
    </StrictMode>,
)
