# PostHog Self-driving setup report

## Summary

PostHog Self-driving is configured for the Vibed web application. Session Replay, Error Tracking, and Support are enabled; health, error-tracking, and support responders are enabled; and two Replay Vision monitors now feed verified visual defects into the inbox.

Findings will begin appearing in the [Self-driving inbox](https://eu.posthog.com/project/305125/inbox) within about 30 minutes after new data and recordings arrive.

## AI data processing

Approved by the wizard gate before this setup ran.

## GitHub

GitHub App: already connected before this run.

## Products enabled

| Product | Result | Notes |
|---|---|---|
| Session Replay | Already enabled | The React `posthog-js` initialization no longer disables recording at startup. Recording remains governed at runtime by the existing consent flow. |
| Error Tracking | Enabled | The web SDK has no `capture_exceptions: false` override. |
| Support (Conversations) | Enabled | Tickets will arrive only after an inbound email, inbox, or Slack channel is connected. |

## Signal sources

| Signal source | Action | Details |
|---|---|---|
| `health_checks` / `health_issue` | Enabled | Config ID `01a1375a-5450-732c-b723-d4cc6d9f23f9`. |
| `error_tracking` / `issue_created` | Enabled | Config ID `01a1375a-54f9-7816-8cb0-2e316b25e05a`. |
| `error_tracking` / `issue_reopened` | Enabled | Config ID `01a1375a-5443-740b-b6b4-648564ec3354`. |
| `error_tracking` / `issue_spiking` | Enabled | Config ID `01a1375a-5474-76b7-b5a8-aca1c68064d1`. |
| `conversations` / `ticket` | Enabled | Config ID `01a1375a-5445-75a7-b06a-c77f24916c33`; remains idle until a support channel is connected. |
| `signals_scout` / `cross_source_issue` | On by default | No opt-out row existed, so no row was created. |
| Logs | Skipped | No evidence that the PostHog Logs product is in use. |
| Endpoints | Skipped | Endpoint usage could not be checked with the available MCP scope. |
| Session Replay responder | Skipped | Replay Vision scanners are the active route for replay findings. |

## Connected tools

No connected-tool responder was authorized in this setup. Sentry was detected in the codebase, but the connected-tools selection was dismissed, so no external source or responder was enabled.

## Scout troop

### Enabled troop

| Scout | Why it is enabled |
|---|---|
| General | Watches cross-product correlations and surfaces not covered by a specialist. |
| Web analytics | Watches traffic, attribution, landing-page health, and 404 patterns. |
| Unused features | Identifies reachable pages or controls with unusually low adoption. |

`Inbox validation` remains enabled as the operational scout. It runs report follow-up checks and sits outside the troop ceiling.

### Disabled scouts

Twenty-five built-in scouts remain disabled because their product surfaces are not evidenced as active in this project or are covered elsewhere. Error Tracking is covered by its native responder; Session Replay is covered by the Replay Vision monitors below. Other specialists can be enabled later from the inbox if their corresponding PostHog products become active.

### Limits

| Limit | Verified value |
|---|---|
| Maximum scout runs per day | 100 |
| Runs used today | 0 |
| Runs remaining today | 100 |
| Maximum enabled scouts | 250 |
| Free non-operational/custom slots counted for this setup | 249 |

Banner: “Scouts are in early access. Each project gets up to 100 scout runs a day. Contact team-self-driving@posthog.com if you need more.”

## Custom scouts

No custom scouts were created. Two proposals were presented and declined:

- Editor-journey drop-off monitoring — ruled out because the enabled web and unused-feature scouts already partially cover the available page and interaction signals, while no dedicated PostHog editor-completion event exists yet.
- Checkout-handoff conversion monitoring — ruled out because the current browser checkout redirect has no explicit PostHog start/success event pair; a reliable conversion discriminator is not yet available.

If a future custom scout becomes noisy, set its `emit` configuration to `false` in PostHog to switch it to dry-run.

## Replay Vision scanners

A Replay Vision scanner is an LLM that watches individual session recordings on a schedule and pushes confirmed findings to the inbox. It is the only part of this setup that spends Replay Vision quota. Findings arrive at half weight and need corroboration before they are promoted to an inbox report.

| Monitor | Status | Scope | Sampling | Estimate |
|---|---|---|---:|---:|
| Vibed editor breakage | Created | Sessions visiting `/editor`, the core editing and export flow; watches visible loading, timeline, preview, control, and export breakage. | 50% | 0 observations / 0 credits per month from the current seven-day sample. |
| Vibed editor frustration | Created | Sessions with a `$rageclick`; watches visible editor-control, timeline, panel, project-loading, and export struggle. | 100% | 0 observations / 0 credits per month from the current seven-day sample. |

Both scanners emit findings to Self-driving. There were no recordings at setup time, so they are armed and will begin scanning when new consented recordings arrive. The Replay Vision budget has 2,500 credits remaining in the current period and is not exhausted.

## Files modified or created

| File | Change |
|---|---|
| `.env` | Created/updated `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` with the configured project values. |
| `src/lib/posthog.js` | Removed the initialization-time replay override, retained consent-driven runtime recording controls, and required configured key/host values in development. |
| `posthog-self-driving-report.md` | Created this report. |
| `dist/` | Regenerated by the verification build. |

## Follow-ups

- [ ] Connect an inbound Support channel (email, inbox, or Slack) so Conversation tickets can reach Self-driving. Use [Integrations settings](https://eu.posthog.com/project/305125/settings/environment-integrations).
- [ ] Deploy the configured `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` values to each hosted web environment; new browser sessions must grant the existing replay consent for recordings to begin.
- [ ] Add explicit, non-PII PostHog events for editor completion/export and checkout start/success if you want reliable product-specific funnel monitoring later.
- [ ] Review and rate the first Replay Vision observations in PostHog so the two monitor prompts can be refined if needed.

## What happens next

The scout coordinator picks up fresh configuration within about 30 minutes. Scouts draw from the verified daily run budget, while Replay Vision monitors evaluate new recordings as they complete. Findings cluster into reports in the Self-driving inbox, where immediately actionable findings can start coding tasks.

## Verification

`npm run build` completed successfully. The build reported existing chunking warnings but no build errors; Sentry source maps were uploaded during the configured build process.
