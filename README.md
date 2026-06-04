# StreakUp — Enterprise loyalty & white-label platform

StreakUp is a multi-tenant SaaS for café loyalty streaks: customers earn visits, HQ operators run analytics and branding, branch managers review traffic, cashiers record check-ins, and super administrators govern the entire fleet from a dedicated control plane.

This repository is organized as a **Vite + React** web client (`web/`) backed by **Supabase** (Postgres, Row Level Security, Auth, Storage, Edge Functions). SQL migration scripts in `supabase/` are applied in order (`init.sql` through `phase11.sql`) to evolve the schema, policies, and automation. **Phase 11** (`supabase/phase11.sql`) adds the Free tier row, super-admin read access to `webhook_outbox` for telemetry, and (after `commit`) the **pg_cron** job that posts to `dispatch-webhooks` every minute — edit placeholders in that file before running the cron section.

---

## Architecture at a glance

| Layer | Responsibility |
|--------|-----------------|
| **Postgres + RLS** | Tenant isolation by `cafe_id`, role-scoped policies (`super_admin`, `hq_owner`, `branch_manager`, `cashier`, customer flows), plan limits (`plan_tiers`, `subscriptions.plan_tier`), API keys (hashed secrets), outbound webhooks + durable **`webhook_outbox`** queue. |
| **Supabase Auth** | Email/password (and extensible) for staff; JWT claims drive `profiles.role` and workspace routing. |
| **Storage** | `logos` bucket for white-label café logos with path-scoped policies. |
| **Edge Functions** | Visit ingestion, AI-assisted flows where configured, **admin tenant provisioning**, and **`dispatch-webhooks`** — a service-role worker that drains `webhook_outbox` and POSTs JSON to customer HTTPS endpoints. |
| **pg_cron + pg_net** | Optional in-database scheduler (Phase 11) to `POST` the dispatcher every minute so webhook delivery is self-sustaining without external cron. |
| **React SPA** | Role-based dashboards: Super Admin (`/admin`), HQ (`/hq/:slug`), Branch (`/branch/:code`), Cashier (`/cashier/:branchCode`), customer **My Streak** experience. Branding applied via CSS variables from café settings. |

---

## Role-based workspaces

- **Super Admin** (`/admin`): platform metrics, tenant registry, per-café operations (status, subscription tier from Free → Enterprise), audit trail, **live `platform_config` editor** (maintenance, locale, announcements, and raw JSON keys).
- **HQ owner** (`/hq/:slug`): overview, branches, **Brand** (palette + logo upload), **Integrations** (API keys + outbound webhooks with plan gates), **Billing & plan** (tier limits, upgrade messaging), optional **branch console** when operating a single location.
- **Branch manager** (`/branch/:code`): visit ledger and branch rhythm UI.
- **Cashier** (`/cashier/:code`): PIN pad, visit recording (online + offline queue).
- **Customer**: streak home and café-branded surfaces where applicable.

---

## AI & Edge integrations

Edge routes live under `supabase/functions/`. Typical patterns:

- **JWT-protected** functions for authenticated staff or service workflows.
- **Scoped API keys** (HQ-minted, hashed at rest) for POS or kiosk integrations calling visit ingestion.
- **AI features** (when enabled) should remain stateless at the edge, persist only derived, non-sensitive outcomes in Postgres, and respect RLS on any follow-up reads from the client.

Configure model keys and feature flags via Supabase **secrets** — never commit secrets to git.

---

## Local development

### Prerequisites

- Node.js 20+ recommended  
- A Supabase project (URL + anon key + service role for Edge)

### Web application

```bash
cd web
npm install
cp .env.example .env   # if present; set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

Production build:

```bash
cd web
npm run build
```

### Supabase CLI (schema, functions, types)

From the repository root (or `supabase/` depending on your layout):

```bash
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
```

Apply SQL phases in the **SQL Editor** in the dashboard (recommended for controlled production rollout), or use `supabase db push` / migrations if you convert these scripts into versioned migrations.

Deploy Edge Functions:

```bash
supabase functions deploy dispatch-webhooks
supabase functions deploy admin-provision-tenant
# …other function names as needed
```

Set function secrets (example for the webhook dispatcher):

```bash
supabase secrets set WEBHOOK_DISPATCH_SECRET=<long-random-string>
```

The dispatcher expects header `x-webhook-dispatch-secret` matching `WEBHOOK_DISPATCH_SECRET`. `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are injected automatically in the Edge runtime.

---

## Webhook automation (Phase 10–11)

1. HQ creates rows in **`outbound_webhooks`** (HTTPS URLs, enabled events).  
2. Triggers on **`visits`** / **`rewards`** enqueue **`webhook_outbox`** rows.  
3. **`dispatch-webhooks`** Edge Function (POST, shared secret) dequeues pending rows and performs outbound HTTP.  
4. **`supabase/phase11.sql`** (tail section) schedules **pg_cron** every minute to `net.http_post` your function URL — replace `YOUR_PROJECT_REF` and `YOUR_DISPATCH_SECRET` before running.

---

## Internationalization & RTL

Default locale can be driven from **`platform_config.default_locale`**. The app syncs document `dir` (`rtl` / `ltr`) with the active UI locale. Super Admins edit defaults under **Admin → System settings**.

---

## Security notes

- **RLS** is the primary isolation mechanism; avoid service-role usage in the browser.  
- **API key secrets** are shown once at mint time.  
- **Webhook outbox** is not writable by café users; delivery uses the service role inside Edge.  
- Super Admins receive **read-only SELECT** on `webhook_outbox` (Phase 11) for operational telemetry.

---

## License & support

Proprietary / all rights reserved unless otherwise stated in a separate agreement. For deployment checklists and incident response, extend this document in your organization’s internal wiki and keep production secrets in Supabase Vault or your cloud secret manager.
