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

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Run the SQL migrations **in order** (SQL Editor, or `supabase db push` with the CLI):
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_functions_rls.sql`
   - `supabase/migrations/0003_inventory_rpcs.sql`
   - `supabase/migrations/0004_report_rpcs.sql`
3. **Expose the schema**: Dashboard → Project Settings → API → *Exposed schemas* → add
   `point_of_sale`. (The grants are already in `0001_init.sql`.)

### 2. Google authentication

1. In **Google Cloud Console**, create an OAuth 2.0 Client ID (Web application). Add the Supabase
   callback as an authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. In **Supabase** → Authentication → Providers → **Google**, paste the Client ID + Secret and enable it.
3. Authentication → URL Configuration → add `http://localhost:3000/**` (and your production URL) to
   *Redirect URLs*.

### 3. Environment

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 4. Run

```bash
npm install
npm run dev       # http://localhost:3000
```

> The build/dev scripts use `--webpack` because Serwist doesn't support Turbopack yet.
> The service worker is disabled in development; run `npm run build && npm start` to exercise the PWA.

## First-run flow

1. Sign in with **berlcamp@gmail.com** → provisioned as **super admin** → redirected to `/super-admin`.
2. Create a company and enter its first admin's Google email (creates a pending invitation).
3. That admin signs in with Google → auto-linked to the company → lands on `/admin`.
4. The admin invites managers/cashiers (Users page). Cashiers sign in with Google and go straight to the POS (`/`).

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
