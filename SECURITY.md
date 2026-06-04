# StreakUp — Phase 12 Security Audit (OWASP)

This report documents the Phase 12 enterprise security pass. Every finding
below was patched in-tree; the patches ship in this same phase so staging is
never in an intermediate state.

Scope covered:

- Frontend bundle (`web/`)
- Supabase Edge Functions (`supabase/functions/**`)
- Postgres RPCs and RLS (`supabase/*.sql`)

---

## 1. Input validation (OWASP A03: Injection / A08: Data integrity)

### Finding
Edge Functions and frontend forms used hand-rolled string coercions. Malformed
or malicious payloads (wrong types, huge strings, non-UUIDs, non-hex colours,
non-HTTPS URLs) could reach RPCs and user-visible DOM.

### Patch

- Introduced a single source-of-truth schema library:
  - Edge: `supabase/functions/_shared/validation.ts` with `zUuid`, `zEmail`,
    `zStrongPassword`, `zSlug`, `zTimezone`, `zCurrency`, `zHexColor`,
    `zLogoUrl`, `zPin`, `zSha256`, `zIdempotencyKey`, plus `readValidatedJson`
    that enforces a 256 KiB JSON body limit and returns structured
    `jsonError(...)` on failure.
  - Web: `web/src/lib/validation/schemas.ts` mirroring the edge schemas so a
    payload rejected in the browser can never make it to the wire.
- Rewrote the request bodies of:
  - `record-visit` (UUIDs, SHA-256 idempotency key, bounded `occurred_at`)
  - `admin-provision-tenant` (full provisioning input including HTTPS-only
    logo, hex-only colours, strict-timezone regex)
  - `invite-staff` (Zod `discriminatedUnion` per role to prevent "HQ owner"
    payloads from smuggling `branchId`, etc.)
  - `ai-router` (`discriminatedUnion` by `intent` so each LLM call has its own
    schema; caps `question` at 2000 chars to blunt prompt-injection payloads)
  - `dispatch-webhooks` (bounded `limit`)

Every schema is declared with `.strict()` to reject unknown keys.

---

## 2. Rate limiting / brute force (OWASP A07: Identification & Authentication Failures)

### Finding
`/login`, the Cashier PIN pad, the customer portal (`customer_portal_session`),
`ai-router`, `record-visit`, `admin-provision-tenant`, `invite-staff`, and
`dispatch-webhooks` had no throttling. Anyone could brute-force PINs or run
up LLM cost with a loop.

### Patch

Three complementary layers:

1. Edge Functions — `supabase/functions/_shared/rate-limit.ts`
   In-memory sliding-window counter, keyed by principal (user id / API key id)
   when available, otherwise client IP. Each function now runs a pre-auth
   IP limiter and a post-auth principal limiter. Selected limits:

   | Function                   | Lane                         | Max / Window |
   | -------------------------- | ---------------------------- | ------------ |
   | `record-visit`             | `record-visit:pre-auth`      | 60 / 60s     |
   | `record-visit`             | `record-visit:principal`     | 240 / 60s    |
   | `admin-provision-tenant`   | `provision:pre-auth`         | 20 / 60s     |
   | `admin-provision-tenant`   | `provision:principal`        | 30 / 5 min   |
   | `invite-staff`             | `invite-staff:pre-auth`      | 60 / 60s     |
   | `invite-staff`             | `invite-staff:principal`     | 120 / 60s    |
   | `ai-router`                | `ai-router:pre-auth`         | 30 / 60s     |
   | `ai-router`                | `ai-router:principal`        | 30 / 60s     |
   | `dispatch-webhooks`        | `dispatch-webhooks:pre-auth` | 20 / 60s     |

   When tripped, the function returns HTTP 429 with `Retry-After` and a JSON
   body `{ error: "rate_limited", retryAfterMs }`.

2. Browser — `web/src/lib/security/rateLimit.ts`
   Rolling-window counter persisted in `sessionStorage`, used for UX-level
   cooldown on:
   - Staff `/login` (5 / 60s, 30s cooldown)
   - Cashier PIN lookup (5 / 60s, 45s cooldown)
   - Customer portal phone+PIN (5 / 60s, 60s cooldown)

   Error strings are i18n-localised and show a live countdown (`{seconds}`
   placeholder) so the user always knows when the form unlocks.

3. Database — `supabase/phase12.sql`
   New `public.auth_lockouts` table + `lockout_check`,
   `lockout_register_failure`, `lockout_register_success` helpers. The
   customer portal RPC and the new `cashier_find_customer_secure` RPC call
   these helpers server-side. This survives Deno isolate restarts and also
   catches attackers who call PostgREST directly.

---

## 3. Authorization / tenant isolation (OWASP A01: Broken Access Control)

### Findings

- The Cashier PIN screen did a direct `supabase.from('customers').select('id').eq(...)`.
  With enough creativity an attacker could probe other tenants' phone numbers
  against a single global PIN namespace and leak cross-tenant IDs.
- `customer_portal_session` exposed an anonymous code path, making brute-force
  possible via the REST endpoint bypassing the browser form.
- Anonymous clients still had `INSERT/UPDATE/DELETE` grants on `customers`,
  `visits`, and `rewards`. RLS blocked it today, but grants would re-expose
  the rows if a future policy regressed.

### Patch

- New `cashier_find_customer_secure(p_phone, p_pin)` SECURITY DEFINER RPC:
  - Resolves `auth.uid()` → `profiles.cafe_id` (only cashier / branch manager
    / HQ owner accepted).
  - Enforces server-side lockout via `lockout_check` on lane `cashier:pin`,
    subject `{cafe_id}:{phone}`.
  - Returns a minimal `{ ok, customer_id, cafe_id }` payload — never the PIN,
    name, or phone. On mismatch returns `{ ok: false, reason: 'not_found' }`
    (or `'rate_limited'`) — identical shape regardless of phone existence,
    preventing oracle attacks.
- `customer_portal_session` now calls the same lockout table for
  `portal:pin`; identical `rate_limited` wrapper; regex pre-filter rejects
  malformed phone/PIN before the SELECT.
- `revoke insert, update, delete on public.customers|visits|rewards from anon`.
- `alter table public.customers … constraint customers_pin_code_chk check
  (pin_code ~ '^[0-9]{4,8}$')` tightens the legacy `4 ≤ length ≤ 12` shape so
  PostgREST cannot insert wildcard-padded PINs that bypass the uniqueness
  index.

---

## 4. CORS + CSRF (OWASP A05: Security Misconfiguration)

### Finding
`_shared/cors.ts` returned `Access-Control-Allow-Origin: *` for every
function. That worked for localhost dev but is too open for production.

### Patch

- New env var `CORS_ALLOWED_ORIGINS` (comma-separated allowlist).
- `corsHeadersFor(req)` picks the request's `Origin` only if it appears on
  the list, otherwise falls back to the first entry (still `*` when the list
  is empty, preserving local dev). Always sets `Vary: Origin` and explicitly
  scopes `Access-Control-Allow-Methods` to `POST, OPTIONS`.
- Every function now returns `corsHeadersFor(req)` instead of the static
  wildcard map.

All state-changing Edge Functions require a bearer token or the tenant API
key, both of which are not sent from cross-origin browser code without an
explicit `Authorization` header, so there is no cookie-backed CSRF vector.

---

## 5. SSRF in webhook dispatcher (OWASP A10)

### Finding
`dispatch-webhooks` fetched arbitrary tenant-supplied URLs. An attacker could
register `http://169.254.169.254/latest/meta-data/...`, or `http://10.0.0.5:8080/`
to scan the internal network, or use a 302 redirect through
`https://evil.com` → `http://169.254.169.254`.

### Patch

- New `assertSafeOutboundUrl` in `_shared/rate-limit.ts`:
  - Only `https:` is allowed.
  - Rejects `localhost`, RFC1918 private ranges (10/8, 172.16/12, 192.168/16),
    link-local `169.254/16`, IPv6 `::1`, `fc00::/7`, `fe80::/10`, and the
    known cloud-metadata hosts (AWS `169.254.169.254`, GCP `metadata.google.internal`,
    Azure `169.254.169.254`).
- `dispatch-webhooks`:
  - Validates each outbound URL with `assertSafeOutboundUrl`; failures mark
    the delivery as `ssrf_blocked` instead of pending.
  - Sets `redirect: 'manual'` on every `fetch`, so a 3xx response is treated
    as a delivery failure (`redirect_blocked`), closing the redirect bypass.
  - Adds a hard `DELIVERY_TIMEOUT_MS` (10 s) via `AbortController` to prevent
    slow-loris back-pressure.

---

## 6. Timing attacks on shared secrets (OWASP A02)

### Finding
`dispatch-webhooks` compared the `x-webhook-dispatch-secret` header with `==`.
A patient attacker could measure response times to learn the secret prefix.

### Patch

- `timingSafeEqual` (constant-time) exported from `_shared/rate-limit.ts`.
- `dispatch-webhooks` uses it for both the expected/provided secret length
  comparison and the byte comparison.

---

## 7. Stored XSS / CSS + URL injection via branding (OWASP A03)

### Finding
Café owners can set hex colours and a logo URL. The frontend wrote those
values into inline styles and CSS variables:

```ts
target.style.setProperty('--brand-primary', cafe.primary_color);
target.style.setProperty('--brand-logo-url', `url(${cafe.logo_url})`);
```

A malicious value such as `red; background: url('javascript:alert(1)')` or
`javascript:alert(1)` would be interpolated verbatim.

### Patch

- New `sanitizeHexColor(value)` — strict `^#(?:[0-9a-fA-F]{3,8})$` match, no
  CSS expression possible.
- New `sanitizeLogoUrl(value)` — `URL` parse, `https:` scheme only, no
  control chars, max 2048 chars, always re-emitted via `encodeURI()` when
  written into `url("…")`.
- Every `applyBrandingVars` / JSX inline `style={{ backgroundImage }}` call
  now runs the value through these sanitisers. Unknown/bad values fall back
  to the default brand, never to "whatever the tenant typed".
- `HqBrandPage` additionally validates the colour palette with
  `brandPaletteSchema.safeParse` before writing to Postgres, and enforces
  file-type + 2 MB size limits before uploading logos. Legitimate React JSX
  output (café names, branch names, etc.) is unchanged — React already
  escapes text nodes and non-style attributes.

---

## 8. Auth lockouts on `/login` (OWASP A07)

### Finding
The staff `/login` page had no rate limit, inviting credential stuffing.

### Patch

- `LoginPage.tsx` wires in `LOGIN_WINDOW` (5 attempts / 60 s, 30 s cooldown)
  keyed by the entered email (lower-cased, trimmed). During cooldown the
  submit button is disabled and shows a live `T-xx` countdown.
- Input is pre-validated with `loginSchema` so we never send empty /
  malformed credentials to Supabase.
- Supabase auth itself still enforces the ultimate password rules.

---

## 9. Payload size DoS

### Finding
`req.json()` would happily buffer arbitrary-size bodies, opening us up to
memory pressure on cold-starts.

### Patch

- `readValidatedJson` honours `Content-Length` and rejects anything above
  `MAX_JSON_BODY_BYTES = 256 KiB` with HTTP 413 `payload_too_large`.
- For endpoints that stream (none today, but future additions should reuse
  the helper) the same module exposes `readBoundedText` if needed.

---

## 10. Environment / secret hygiene

Re-verified:

- `web/.env.example` and `web/src/lib/env.ts` only reference `VITE_SUPABASE_URL`
  and `VITE_SUPABASE_ANON_KEY`. There are no `SERVICE_ROLE_KEY`, `GROQ_API_KEY`,
  or `STRIPE_SECRET_KEY` references in the client tree. `rg "service_role|groq|secret"`
  over `web/src` confirms only server-invoking paths see these values.
- Edge Functions read secrets via `Deno.env.get(...)` and never echo them in
  responses. `dispatch-webhooks` returns only delivery metadata (status code,
  duration) — never request bodies or response headers that could surface a
  credential.
- `console.log` usage in edge code is limited to structured error logging of
  validation failure codes (never the offending payload) and delivery stats.

---

## 11. RLS cross-check

Policies reviewed under `profiles.role` scenarios (`super_admin`, `hq_owner`,
`branch_manager`, `cashier`, `customer`, `anon`):

- `cafes`, `branches`, `profiles`, `customers`, `visits`, `rewards`,
  `reward_milestones`, `staff_sessions`, `webhook_outbox`, `tenant_api_keys`
  — all select/insert/update/delete paths are gated on `auth.uid()` +
  matching `profiles.cafe_id` (or `streakup_is_super_admin()` / `hq_owner`).
- No `using (true)` policies exist on tenant-scoped tables.
- Phase 12 additionally revokes raw `anon` write grants on `customers`,
  `visits`, and `rewards`, so a future accidental `using (true)` on SELECT
  would still not permit mutations.

---

## Files changed / added in Phase 12

### Added
- `supabase/functions/_shared/validation.ts`
- `supabase/functions/_shared/rate-limit.ts`
- `supabase/phase12.sql`
- `web/src/lib/validation/schemas.ts`
- `web/src/lib/security/rateLimit.ts`
- `SECURITY.md` (this file)

### Modified
- `supabase/functions/_shared/cors.ts`
- `supabase/functions/record-visit/index.ts`
- `supabase/functions/admin-provision-tenant/index.ts`
- `supabase/functions/invite-staff/index.ts`
- `supabase/functions/ai-router/index.ts`
- `supabase/functions/dispatch-webhooks/index.ts`
- `web/src/lib/branding.ts`
- `web/src/routes/auth/LoginPage.tsx`
- `web/src/routes/cashier/CashierHomePage.tsx`
- `web/src/routes/my-streak/MyStreakHomePage.tsx`
- `web/src/routes/admin/AdminProvisionTenantModal.tsx`
- `web/src/routes/hq/HqBrandPage.tsx`
- `web/src/routes/hq/HqDevelopersPage.tsx`
- `web/src/core/i18n/messages/en.json`
- `web/src/core/i18n/messages/ar.json`

---

## Deployment checklist

1. Apply SQL: `supabase db execute --file supabase/phase12.sql` (or run in
   the dashboard SQL editor after `phase11.sql`).
2. Set these Edge Function env vars:
   - `CORS_ALLOWED_ORIGINS` — comma-separated list of your production
     frontends (e.g. `https://app.streakup.com,https://hq.streakup.com`).
   - `WEBHOOK_DISPATCH_SECRET` — already required by Phase 11; now consumed
     via `timingSafeEqual`.
3. Redeploy all functions: `supabase functions deploy`.
4. Rebuild the web bundle (`npm run build` inside `web/`) and deploy.
5. Smoke test:
   - Fail the staff login 5× in a minute → button disables with countdown.
   - Fail the cashier PIN 5× in a minute → server returns `rate_limited`,
     UI shows the matching toast.
   - `POST /functions/v1/ai-router` with `{}` → HTTP 400 with a Zod error
     (never a 500 / stack trace).
   - Register a webhook at `http://169.254.169.254/...` → dispatcher logs
     `ssrf_blocked` and never calls out.

---

## Residual risks / follow-ups

- Rate limiting at the edge is per-isolate; a highly distributed attack
  against Supabase's autoscaled runtime could amortise across isolates.
  The database `auth_lockouts` layer closes that gap for auth flows; for
  `ai-router`/`record-visit` we rely on the combined effect and the
  per-principal limits.
- Two-factor authentication for staff logins is not yet implemented. Supabase
  Auth supports it; wire it up in Phase 13.
- WAF (Cloudflare / Fastly) in front of the Supabase edge would be a cheap
  additional layer; coordinate with ops before enabling so CORS origins stay
  in sync.
