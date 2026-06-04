/**
 * StreakUp — Enterprise API reality test (POS / Foodics-style integration)
 *
 * What this hits (real production path):
 *   Edge Function:  POST {SUPABASE_URL}/functions/v1/record-visit
 *   Auth:           x-streakup-api-key: streakup_<prefix>_<secret>
 *   Server-side:    verify_enterprise_api_key() (service_role) + scope check (visits:write)
 *                  + (branchId/customerId) ownership assertions + record_visit_idempotent()
 *                  + streakup_engine_process_check_in() (when eventType=check_in; Phase19+)
 *
 * Usage:
 *   1) Mint an API key in HQ → Developers (it shows ONCE)
 *   2) Pick a branchId + customerId belonging to the same cafe
 *   3) Run:
 *        node tests/simulate_enterprise_api.js
 *
 * Required env vars:
 *   SUPABASE_URL      e.g. https://xxxx.supabase.co
 *   STREAKUP_API_KEY  e.g. streakup_abcd_verysecret...
 *   BRANCH_ID         uuid
 *   CUSTOMER_ID       uuid
 *
 * Optional:
 *   EVENT_TYPE        check_in | reward_redeem | adjustment | system   (default: check_in)
 *   CLIENT_VISIT_DATE yyyy-mm-dd  (default: null; server uses cafe timezone midnight logic)
 *   IDEMPOTENCY_KEY   (default: auto-generated)
 *
 * Helpful SQL (run in Supabase SQL editor):
 *   -- pick a branch
 *   select id, name, branch_code, cafe_id from public.branches order by created_at desc limit 20;
 *
 *   -- pick a customer in that cafe
 *   select id, cafe_id, phone, full_name, current_streak from public.customers
 *   where cafe_id = '<cafe_id_from_branch>' order by created_at desc limit 20;
 */
+
+import crypto from 'node:crypto'
+
+function requireEnv(name) {
+  const v = process.env[name]
+  if (!v || !String(v).trim()) {
+    throw new Error(`Missing env var ${name}`)
+  }
+  return String(v).trim()
+}
+
+function canonicalPayload({ branchId, customerId, eventType, clientVisitDate }) {
+  return JSON.stringify({
+    branchId,
+    customerId,
+    eventType,
+    clientVisitDate: clientVisitDate ?? null,
+  })
+}
+
+function sha256Hex(input) {
+  return crypto.createHash('sha256').update(input).digest('hex')
+}
+
+function randomIdempotencyKey() {
+  // matches server regex: /^[A-Za-z0-9._~:\-]{8,128}$/
+  return `pos_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
+}
+
+async function main() {
+  const supabaseUrl = requireEnv('SUPABASE_URL').replace(/\/+$/, '')
+  const apiKey = requireEnv('STREAKUP_API_KEY')
+  const branchId = requireEnv('BRANCH_ID')
+  const customerId = requireEnv('CUSTOMER_ID')
+
+  const eventType = (process.env.EVENT_TYPE || 'check_in').trim()
+  const clientVisitDate = (process.env.CLIENT_VISIT_DATE || '').trim() || null
+  const idempotencyKey = (process.env.IDEMPOTENCY_KEY || '').trim() || randomIdempotencyKey()
+
+  const payloadSha256 = sha256Hex(
+    canonicalPayload({ branchId, customerId, eventType, clientVisitDate }),
+  )
+
+  const url = `${supabaseUrl}/functions/v1/record-visit`
+  const body = {
+    branchId,
+    customerId,
+    idempotencyKey,
+    payloadSha256,
+    eventType,
+    clientVisitDate,
+  }
+
+  const res = await fetch(url, {
+    method: 'POST',
+    headers: {
+      'Content-Type': 'application/json',
+      'x-streakup-api-key': apiKey,
+      'x-idempotency-key': idempotencyKey,
+    },
+    body: JSON.stringify(body),
+  })
+
+  const text = await res.text()
+  let json = null
+  try {
+    json = JSON.parse(text)
+  } catch {
+    // leave as text
+  }
+
+  console.log('--- REQUEST ---')
+  console.log({ url, idempotencyKey, payloadSha256, eventType, clientVisitDate, branchId, customerId })
+  console.log('--- RESPONSE ---')
+  console.log('status:', res.status)
+  console.log(json ?? text)
+
+  if (!res.ok) process.exitCode = 1
+}
+
+main().catch((e) => {
+  console.error(e)
+  process.exitCode = 1
+})

