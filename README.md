# PointOne POS

A multi-tenant, offline-first **Point of Sale** PWA built with **Next.js 16**, **Supabase**
(custom `point_of_sale` schema), and **Google authentication**. The POS terminal keeps working
without internet — sales are queued locally (IndexedDB) and auto-sync when the connection returns.

The POS and admin UX replicates the reference app *Tangub City Hardware*, re-implemented on a new
multi-tenant, PWA + Supabase stack.

## Features

- **Multi-tenant** — every company's data is isolated with Postgres Row-Level Security.
- **Super admin** (`berlcamp@gmail.com`) onboards companies and assigns their first admin.
- **Roles** — `super_admin` → `admin` → `manager` → `cashier`.
- **Google-only login**; staff join by invitation (email is pre-authorized, auto-linked on first sign-in).
- **POS terminal** — product search, multi-unit pricing, cart, discounts, Cash/GCash/Card, change, receipt (print).
- **Offline sales** — browse cached products and complete sales offline; idempotent auto-sync.
- **Admin** — Dashboard (charts), Products (unit editor), Inventory (FIFO batches, movements), Reports (5 tabs, returns), Audit Log, Users.
- **Installable PWA** with a Serwist service worker.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (`@supabase/supabase-js`,
`@supabase/ssr`) · Serwist (`@serwist/next`) · Dexie (IndexedDB) · Recharts · lucide-react.

## Local development

Development runs against a **local Supabase stack** in Docker — no cloud project needed, and the
data is yours to reset at will. Ports are non-default (see `supabase/config.toml`) so the stack can
coexist with other Supabase projects on the same machine:

| Service | URL |
| --- | --- |
| API / auth | `http://127.0.0.1:55521` |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:55522/postgres` |
| Studio | `http://127.0.0.1:55523` |
| Mailpit (inbox) | `http://127.0.0.1:55524` |

### 1. Prerequisites

Docker Desktop, running. The Supabase CLI is invoked via `npx supabase` — no global install needed.

### 2. Start the stack

```bash
npm install
npx supabase start
```

Migrations in `supabase/migrations/` apply automatically on first start, and the `point_of_sale`
schema is already exposed via `api.schemas` in `supabase/config.toml`. To wipe and re-apply
everything (plus `supabase/seed.sql`), run `npm run db:reset`.

> `db:reset` has been seen to fail mid-run yet still exit looking successful, leaving the database
> with no `point_of_sale` schema. Confirm it actually worked before trusting it:
> ```bash
> psql "postgresql://postgres:postgres@127.0.0.1:55522/postgres" -c "\dt point_of_sale.*"
> ```

### 3. Google OAuth for localhost

Local auth needs its **own** OAuth client — the redirect URI points at your local Supabase, not at
`localhost:3000` and not at a cloud project.

1. **Google Cloud Console** → APIs & Services → Credentials → **Create OAuth client ID** →
   *Web application*.
2. Under **Authorized redirect URIs** add exactly:
   ```
   http://127.0.0.1:55521/auth/v1/callback
   ```
   Use `127.0.0.1`, not `localhost`. This is the value GoTrue derives from `api.port` and sends as
   `redirect_uri`; Google requires a character-for-character match against a registered URI, so
   `localhost` here fails with `redirect_uri_mismatch`. Confirm what it actually sends with
   `docker inspect supabase_auth_point-of-sale --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GOOGLE_REDIRECT_URI`.
   No *Authorized JavaScript origins* entry is required.
3. Create a **`.env` at the repo root** (gitignored — this is separate from `.env.local`; the
   Supabase CLI reads `env()` substitutions in `config.toml` only from this file):
   ```
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=<client-secret>
   ```
4. Restart so the auth container picks the values up — a bare `supabase start` will **not**
   recreate an already-running container:
   ```bash
   npx supabase stop && npx supabase start
   ```

Verify with:

```bash
curl -si "http://127.0.0.1:55521/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback" | grep -i location
```

The `Location` header should carry your real `client_id` and preserve `redirect_to` unchanged. If
`redirect_to` comes back rewritten to the bare site URL, the target is missing from
`auth.additional_redirect_urls` in `config.toml`.

### 4. App environment

Copy `.env.example` to `.env.local` and point it at the local stack. The anon key is the shared
local default, printed by `npx supabase status`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55521
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from `npx supabase status`>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 5. Run

```bash
npm run dev       # http://localhost:3000
```

> Browse via `http://localhost:3000`, not `http://127.0.0.1:3000`. Both are allowlisted in
> `config.toml`, but only `localhost` matches `NEXT_PUBLIC_SITE_URL` — mixing them splits session
> cookies across two browser origins and you will appear logged out.

> The build/dev scripts use `--webpack` because Serwist doesn't support Turbopack yet.
> The service worker is disabled in development; run `npm run build && npm start` to exercise the PWA.

## First-run flow

1. Sign in with **berlcamp@gmail.com** → provisioned as **super admin** → redirected to `/super-admin`.
2. Create a company and enter its first admin's Google email (creates a pending invitation).
3. That admin signs in with Google → auto-linked to the company → lands on `/admin`.
4. The admin invites managers/cashiers (Users page). Cashiers sign in with Google and go straight to the POS (`/`).

Because Google is the only login method, every test account needs a real Google address. To try a
role without a second Google account, invite the address and then repoint the row in Studio, or seed
the membership directly in `supabase/seed.sql`.

## Deploying to a hosted Supabase project

The cloud setup differs from local only in where auth is configured:

1. Create a project at [supabase.com](https://supabase.com) and push the schema with
   `npx supabase link --project-ref <ref>` then `npx supabase db push`.
2. Dashboard → Project Settings → API → *Exposed schemas* → add `point_of_sale`. (The grants are
   already in `0001_init.sql`.) This is the cloud equivalent of `api.schemas` in `config.toml`.
3. Create a **second** OAuth client in Google Cloud Console whose authorized redirect URI is
   `https://<project-ref>.supabase.co/auth/v1/callback`, and paste its Client ID + Secret into
   Authentication → Providers → **Google**.
4. Authentication → URL Configuration → set *Site URL* to your production origin and add it to
   *Redirect URLs*.
5. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SITE_URL` in
   your host's environment. `.env` (the Supabase CLI file) is local-only and is not deployed.

## Offline behavior

- On load (online), active products are mirrored into IndexedDB.
- Offline, the POS searches the cached mirror and completes sales, queued in an outbox with a
  client-generated UUID.
- When back online (event, 30s interval, or manual "pending" button) the outbox flushes via the
  idempotent `create_sale` RPC — each sale is written exactly once, inventory decremented once.

## Project structure

```
src/
  app/                    routes: / (POS), /admin/*, /super-admin, /login, /auth/callback, sw.ts, manifest.ts
  components/
    pos/                  POS terminal + Cart, ProductSearch, Checkout/Receipt, SalesHistory
    admin/                Dashboard, Products, Inventory, Reports, Audit, Users, sidebar
    super-admin/          Companies manager
  lib/
    supabase/             browser + server + middleware clients (scoped to point_of_sale)
    offline/              Dexie db + sync (product mirror, outbox flush)
    auth/session.ts       server-side profile fetch
    types.ts, config.ts
supabase/migrations/      ordered SQL (schema, RLS, RPCs, reports)
```
