You are the Chief Software Architect, Expert Full-Stack Developer, and Lead UX/UI Designer for a billion-dollar potential SaaS platform. Read this ENTIRE Master Specification Document carefully. 

🚨 ABSOLUTE CREATIVE MANDATE 🚨
Do NOT just follow these instructions blindly like a typewriter. You have ABSOLUTE CREATIVE FREEDOM. I am giving you the core vision; your job is to take it, enhance it, optimize it, and multiply the creativity. If you see a smarter architectural pattern, a more breathtaking UI/UX approach, a faster database query, or a brilliant feature we haven't thought of—IMPLEMENT IT OR PROPOSE IT. Push the boundaries of what is possible. We are building a world-class, ultra-premium Enterprise SaaS.

SYSTEM NAME: "StreakUp" 
============================
1. ARCHITECTURE & TECH STACK (ULTRA-PREMIUM)
============================
- Frontend: React 18 + Vite 5 + TailwindCSS 3
- UI/Animations: Framer Motion (go wild here: fluid transitions, glowing active nodes, fire flicker effects, dynamic layout morphs). Use shadcn/ui or Radix UI for highly accessible, luxurious dashboard components.
- Backend/DB/Auth/Realtime: Supabase (PostgreSQL)
- Hosting: Vercel
- Smart Features: Papaparse (for AI-assisted Excel/CSV bulk branch uploads).

CRITICAL ARCHITECTURE NOTE: The Backend logic and Edge Functions MUST be perfectly decoupled from the UI. The frontend only consumes APIs. This API-First design is mandatory so we can instantly offer Enterprise API access to POS systems (like Foodics) and corporate apps.

ENTRYPOINT NOTE: Staff authenticate only through the corporate `/login` portal; the app resolves `profiles.role` and redirects to the correct dashboard. Customers and cashiers enter only via their issued deep links (`/my-streak/:slug`, `/cashier/:branch_code`) — never through a public “tier picker”.

============================
2. THE 5-TIER HIERARCHY (ENTERPRISE ROUTING)
============================
The system must support a complex, flawless 5-tier permission model. RLS (Row Level Security) must strictly isolate data based on these roles:

1. SUPER ADMIN (`/admin`):
   - Access: Everything.
   - Powers: Create/Delete Cafes (HQs), manage subscriptions, global platform metrics, full system override.

2. THE ENTERPRISE HQ (Corporate Owner - `/hq/:slug`):
   - Access: Owns the `cafe_id`.
   - Powers: Acts as the "Super Admin" for their specific brand. Can add/remove branches (via UI or AI CSV upload), reset Branch Manager passwords, generate Cashier PINs, manage B2B API Keys, and view deep analytics (aggregated across all branches or filtered by specific branch).

3. THE LOCAL LEADER (Branch Manager - `/branch/:branch_code`):
   - Access: Owns the `branch_id`.
   - Powers: Sees ONLY their specific branch data. Views local check-ins, local rewards claimed, local ROI, and manages local cashier operations. Cannot see other branches.

4. THE EXECUTIONER (Cashier - `/cashier/:branch_code`):
   - Access: Bound to `branch_id` via a 4-digit Cashier PIN.
   - Powers: Minimalist, ultra-fast Reverse-PIN numpad. Only records visits and confirms rewards. No analytics access.

5. THE PLAYER (Customer - `/my-streak/:slug`):
   - Access: Bound by phone number + personal PIN.
   - Powers: Views their visual roadmap, streaks, and rewards. Seamlessly recognized across ANY branch of the HQ.

============================
3. GLOBAL EXPANSION & COMPLIANCE (US/EU/MENA)
============================
- Bilingual System: Arabic (RTL) and English (LTR). Use Context + JSON. No hardcoded text.
- Timezone & Currency Engine: ALL date calculations MUST execute strictly according to the HQ's `timezone` field in the database. Never rely on the client's browser time.
- GDPR Ready: Mandatory consent timestamps (`gdpr_consent_date`) on registration.

============================
4. DESIGN SYSTEM & UX (LUXURY FEEL)
============================
- Theme: Premium Dark Mode (#0f0f0f backgrounds, glowing accents).
- Haptic Feedback: Implement `navigator.vibrate()` for tactile feedback on interactions.
- White-labeling: The UI must dynamically absorb the HQ's `primary_color`, `secondary_color`, and `logo_url` from the database to completely brand the customer and cashier screens.

============================
5. DATABASE SCHEMA (SUPER-SCALABLE POSTGRESQL)
============================
(Feel free to optimize indexes/triggers, but maintain these core relationships)

1. cafes (HQ): id, name, slug, logo_url, primary_color, secondary_color, owner_password, timezone, currency_code, off_days, shield_every, max_shields, status.
2. branches: id, cafe_id (HQ reference), name, branch_code, manager_password, cashier_pin.
3. api_keys: id, cafe_id, key_string (For Enterprise integrations).
4. customers: id, cafe_id, phone, pin_code, current_streak, longest_streak, shields, gdpr_consent_date. UNIQUE(cafe_id, phone), UNIQUE(cafe_id, pin_code).
5. visits: id, customer_id, cafe_id, branch_id (Crucial for analytics), visit_date, streak_after, event_type.
6. reward_milestones & rewards: Tracks days_required and earned/claimed status.
7. audit_log: IMMUTABLE ledger for dispute resolution.

ENABLE RLS ON ALL TABLES.

============================
6. THE STREAK ENGINE (Core Brain)
============================
A unified function that calculates streaks dynamically. It must:
- Detect the `branch_id` where the visit occurred.
- Check timezone bounds for consecutive days.
- Automatically award shields or milestones.
- If a user visits Branch A today, and Branch B tomorrow (both under the same HQ), the streak seamlessly continues.

============================
7. EXECUTION DIRECTIVE
============================
I want extreme intelligence, flawless state management, and highly modular code. Do not write the code yet. 
First: Acknowledge this Master Plan. Provide a high-level technical brief on how you plan to orchestrate the 5-Tier Auth system, the Framer Motion UI, and the decoupled API approach. Add your own creative suggestions to make this platform 10x better. Once you are ready, say "Awaiting your command to initiate Phase 1."

Use the indexed docs (@Supabase, @Framer Motion, @shadcn/ui, @date-fns) extensively to ensure your solutions use the absolute latest, most performant, and secure enterprise patterns available today. Do not use outdated workarounds.