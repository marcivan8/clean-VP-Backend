# Staging Environment + CI/CD Setup

One-time steps to get the full pipeline running.

---

## 1 — Create the `staging` branch

```bash
git checkout -b staging
git push -u origin staging
```

---

## 2 — Set up Railway environments

### 2a — Open your Railway project

Go to [railway.app](https://railway.app) → your project.

### 2b — Create a Staging environment

1. In the project header, click the **environment switcher** (shows "Production").
2. Click **"New Environment"** → name it **`staging`**.
3. Railway clones all your services and variables from production into the new environment.

### 2c — Wire each environment to a Git branch

**Production environment:**
1. Select **Production** in the switcher.
2. Click your service → **Settings** → **Source** → **Branch** → set to `main`.
3. **Disable** "Auto Deploy" (GitHub Actions will trigger deploys instead).

**Staging environment:**
1. Select **Staging** in the switcher.
2. Click your service → **Settings** → **Source** → **Branch** → set to `staging`.
3. **Disable** "Auto Deploy" (same reason).

### 2d — Get Railway deploy tokens

You need one token per environment.

1. Go to **railway.app/account/tokens** → **"Create Token"**.
2. Name it `GitHub Actions — staging`, scope it to your project + **staging** environment.
3. Copy the token.
4. Repeat for production (`GitHub Actions — production`, **production** environment).

### 2e — Add staging-specific env vars

In the **Staging** environment, override any variables that differ from production:

| Variable | Suggested staging value |
|---|---|
| `NODE_ENV` | `staging` |
| `BYPASS_USAGE_GATE` | `true` (so you can test without hitting quota) |
| `SENTRY_DSN` | same DSN, or a separate staging Sentry project |
| `VITE_SENTRY_DSN` | same as SENTRY_DSN |
| `FRONTEND_URL` | your staging Railway URL |

---

## 3 — Add GitHub secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**.

### Required

| Secret | Where to get it |
|---|---|
| `RAILWAY_TOKEN_STAGING` | From step 2d above |
| `RAILWAY_TOKEN_PRODUCTION` | From step 2d above |

### Required for Sentry source maps (once you have a Sentry account)

| Secret | Where to get it |
|---|---|
| `VITE_SENTRY_DSN` | Sentry dashboard → Project → Settings → Client Keys → DSN |
| `SENTRY_ORG` | Your Sentry organisation slug (URL slug, e.g. `viralpilotr`) |
| `SENTRY_PROJECT` | Your Sentry project slug |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens → Create (scopes: `project:releases`, `org:read`) |

---

## 4 — Set up Sentry

1. Go to [sentry.io](https://sentry.io) → create a free account.
2. Create a new **Project** → choose **React** as the platform.
3. Copy the DSN shown during setup.
4. Add `SENTRY_DSN` + `VITE_SENTRY_DSN` to your Railway production **and** staging environments.
5. Add the four Sentry GitHub secrets from the table above.

That's it — after the next push to `staging`, the full pipeline runs:

```
push to staging
  → GitHub Actions: lint + test + build
  → Upload source maps to Sentry
  → railway up → staging Railway environment
  → sentry release created
```

And the same on `main` → production.

---

## 5 — Day-to-day workflow

```
feature branch → PR → CI checks pass → merge to staging → auto-deploy to staging
staging passes QA  → PR into main → merge → auto-deploy to production
```
