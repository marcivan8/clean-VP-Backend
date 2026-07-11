# Staging Setup — Dashboard Feature

Follow these steps once to wire up the staging environment and deploy the
multi-project dashboard for testing.

---

## 1. Update the staging branch

The staging branch is behind main. Bring it current, then add the new code:

```bash
git checkout staging
git merge main          # pulls in TDZ fix, Redis fix, skill files, etc.
git push origin staging
```

The code changes for the dashboard (planLimits, useUserPlan, App.jsx,
EditorPage, DashboardPage) are already in your working tree on main.
After the merge they'll be on staging too.

---

## 2. Run migrations on the staging Supabase project

Open **Supabase Dashboard → SQL Editor** for your **staging** project and run
each migration in order:

### 002_usage_gates.sql
```sql
alter table public.profiles
    add column if not exists plan text not null default 'free'
        check (plan in ('free', 'creator', 'pro')),
    add column if not exists plan_expires_at timestamptz;

create table if not exists public.usage_events (
    id         uuid        primary key default gen_random_uuid(),
    user_id    uuid        not null references auth.users(id) on delete cascade,
    operation  text        not null,
    created_at timestamptz not null default now()
);
create index if not exists usage_events_user_month_idx
    on public.usage_events (user_id, created_at desc);
alter table public.usage_events enable row level security;
create policy "usage_events: own rows read"
    on public.usage_events for select using (auth.uid() = user_id);
```

### 003_projects.sql
```sql
create table if not exists public.projects (
  id            uuid          primary key default gen_random_uuid(),
  user_id       uuid          not null references auth.users(id) on delete cascade,
  name          text          not null default 'Untitled Project',
  thumbnail_url text,
  aspect_ratio  text          not null default '16:9',
  duration      numeric(10,3) not null default 0,
  timeline_state jsonb        not null default '{}'::jsonb,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);
create index if not exists projects_user_updated_idx
    on public.projects (user_id, updated_at desc);
alter table public.projects enable row level security;
drop policy if exists "users_own_projects" on public.projects;
create policy "users_own_projects"
    on public.projects for all
    using  (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
    before update on public.projects
    for each row execute procedure public.set_updated_at();
```

### Profiles RLS (allow users to read their own plan)
If not already present, add this policy so `useUserPlan` can read the plan column:
```sql
-- Check if it already exists first
select policyname from pg_policies
where tablename = 'profiles' and policyname like '%select%';

-- If missing, add it:
create policy "profiles: own row select"
    on public.profiles for select using (auth.uid() = id);
```

---

## 3. Set environment variables on the Railway staging service

In **Railway → staging service → Variables**, confirm these are set:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Your **staging** Supabase project URL |
| `SUPABASE_ANON_KEY` | Staging anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging service role key |
| `VITE_SUPABASE_URL` | Same as SUPABASE_URL (Vite client) |
| `VITE_SUPABASE_ANON_KEY` | Same as anon key (Vite client) |
| `REDIS_URL` | Staging Redis instance |
| `GCS_BUCKET_NAME` | Staging GCS bucket (or reuse prod bucket with a staging/ prefix) |
| `AWS_LAMBDA_FUNCTION_NAME` | Lambda function name (e.g. `revideo-render-lambda`) |
| `AWS_REGION` | Lambda region (e.g. `us-east-1`) |
| `POLAR_WEBHOOK_SECRET` | Can be omitted on staging |
| `POLAR_PRODUCT_CREATOR` | Optional — only needed to test upgrade flow |
| `POLAR_PRODUCT_PRO` | Optional — only needed to test upgrade flow |

---

## 4. Deploy

Railway auto-deploys when you push to the staging branch:

```bash
git push origin staging
```

Watch the deploy log. When it goes green, open your staging URL.

---

## 5. Test checklist

Go through each of these before merging to main:

- [ ] `/auth` — sign up a new user, verify profile row created with `plan = 'free'`
- [ ] `/dashboard` — redirects to `/auth` when not logged in
- [ ] `/dashboard` — shows empty state for new user
- [ ] **New project** — creates project, navigates to `/editor/:projectId`
- [ ] **Editor loads** — timeline is empty, project name appears in header
- [ ] **Autosave** — make an edit, wait 3s, reload — changes persist
- [ ] **Reopen project** — go back to `/dashboard`, click the project card, editor loads
- [ ] **Plan limit (free = 1)** — create 1 project, try to create a 2nd → limit modal appears
- [ ] **Limit modal** — "Upgrade" button navigates somewhere sensible
- [ ] **Rename** — 3-dot menu → rename works
- [ ] **Duplicate** — creates a copy, count increments
- [ ] **Delete** — removes project, count decrements
- [ ] **Search** — filters project cards correctly

### To test Creator/Pro limits without Polar:
```sql
-- In staging Supabase SQL Editor:
update public.profiles set plan = 'creator' where email = 'your@email.com';
-- Refresh dashboard → limit is now 10
update public.profiles set plan = 'pro' where email = 'your@email.com';
-- Refresh dashboard → limit shows ∞
```

---

## 6. Merge to production

Once all checks pass:

```bash
git checkout main
git merge staging
git push origin main   # Railway production auto-deploys
```

Run the same SQL migrations on the **production** Supabase project if not
already done (003_projects.sql is idempotent — safe to re-run).
