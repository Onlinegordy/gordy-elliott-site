# Launch Readiness Pack — Gordy Elliott Portal

A short, practical checklist for launching the portal to production.
Use this instead of memory on launch day.

Last updated: 2026-04-22 (afternoon — trust + real-use sign-off bulldoze).

---

## 0. What's code-complete vs what needs Gordy's eyes (22 Apr afternoon sprint)

**Code-complete (no more code work planned; won't block launch unless a bug shows up):**
- Training logging save/read integrity — timestamped save stamp + weekly sessions-logged strip + mobile sticky Save Session button + per-exercise Promise.all failure detection + error banner with the actual message + auto-refresh of week logs after save.
- Nutrition meal / quick-meal / food-add / manual-add / delete / reset-day error surfacing — every write now checks `response.ok` and toasts on failure instead of silently no-op'ing.
- Check-in photo upload partial-failure reporting — if any progress photo fails to land, the client is told how many failed and where to re-add them, rather than seeing "submitted" with silently missing photos.
- SHIFT AI swap flow grounding — client AI context includes the assigned plan + honest framing about the limited foods library. Header shortcut on nutrition page sends the client directly to SHIFT AI.
- Admin client detail assign/archive/unassign handlers — all `response.ok`-checked and toasted on failure.
- Portal/admin calendar — retry banner on load failure + toast on create failure.

**Needs Gordy's eyes (launch-safe step, not a roadmap gap):**
- Real-phone walkthrough of the full client weekly flow (dashboard → training → nutrition → check-in → progress → AI). Especially watch: sticky save button position on training with keyboard open, nutrition food browser scroll, check-in photo upload feedback.
- Real-client admin AI QA on the full roster. Ask the five prompts in §6 "SHIFT AI" below and confirm the answers match operator intuition.
- One live end-to-end weekly cycle on a real client account: assign plan → client logs session → coach sees it on `/admin/clients/[id]` → coach replies to check-in → client sees reply on `/portal`.
- Visual spot-check on Gordy's actual device (iPhone + laptop) to confirm dark-mode feels intentional, not "works but a bit off."

Anything in the first list that breaks on real use is a bug report.
Anything in the second list is blockers to launch-safe status — not something more code will fix.

---

## 1. Environment variables (parity between preview and prod)

These must be set on Vercel for BOTH preview and production, unless noted.

**Required — any environment that handles real users**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon key (safe to expose)
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (server-only, never in `NEXT_PUBLIC_*`)
- `ANTHROPIC_API_KEY` — SHIFT AI (portal + admin)
- `RESEND_API_KEY` — invite / client-email delivery
- `RESEND_FROM_EMAIL` — from address, must match verified Resend domain
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — web push
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — client-side subscription
- `NEXT_PUBLIC_SITE_URL` — absolute URL used for OG tags + email links

**Recommended**
- `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` — analytics, if used

**Checks before deploy**
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is NOT duplicated into any `NEXT_PUBLIC_*` var.
- Confirm `RESEND_FROM_EMAIL`'s domain is verified in Resend's dashboard.
- Confirm `NEXT_PUBLIC_VAPID_PUBLIC_KEY` matches the `VAPID_PUBLIC_KEY` used on the server.

---

## 2. Supabase schema parity

Before production deploy, the production Supabase project must have every migration in `supabase/migrations/` applied, in order.

Key recent tables/fields to double-check exist in production:
- `client_profiles`: `tier`, `checkin_day`, `checkin_form_id`, `coach_notes`, `primary_goal`, `target_date`, `goal_notes`, `start_weight`
- `client_tasks`: `source` column (`"coach" | "client"`)
- `client_daily_metrics` — full table
- `checkin_forms` — full table + `is_default` column
- `checkins.responses` — JSONB column (stores `priority_message` / `support_ask` for Premium/VIP)
- `client_body_measurements` — full table with 7 measurement columns + notes
- `client_exercise_plans` / `client_exercise_sessions` / `client_exercise_session_items`
- `client_nutrition_plans` / `client_nutrition_meals` / `client_nutrition_meal_items`
- `exercises`, `foods`, `training_modules`, `module_content`

Check order:
1. `supabase db diff --linked` against each migration file.
2. `supabase db push --linked` if there are pending migrations.
3. Spot-check RLS policies are present on every `client_*` table (admins full access, clients own-row only).

---

## 3. Preview vs production pitfalls

Things that have bitten the project before — check each before cutting over:

- **Wrong Supabase project linked.** `.env.local` often points at dev; production must point at the prod project. Run `supabase status` to confirm.
- **Stale roadmap / dashboard localStorage.** The roadmap uses a `STORAGE_KEY` that is bumped when seeding changes — if seeding changed between preview and prod, the progress bar may look wrong until the key is bumped.
- **Dark mode state is per-user (`portal-theme` in localStorage).** A client seeing dark mode on staging may not be the default on prod.
- **Push subscriptions tied to VAPID keys.** If VAPID keys differ between preview and prod, existing subscriptions won't work on the new env — clients must re-enable notifications.
- **Resend sender domain.** A preview env pointed at an unverified domain will appear to accept emails and silently fail delivery.
- **Service worker cache.** If `public/sw.js` changed, users on the old service worker may keep serving stale UI until they refresh twice.

---

## 4. Smoke-test sequence (post-deploy, before announcing)

Do these in order on production. Each should take < 1 minute.

### Client-side — use a real test client account
1. `/login` — confirm successful sign-in
2. `/portal` — confirm tier-aware hero loads, Coach Priorities renders, no console errors
3. `/portal/exercise-plan` — confirm week strip shows, today's session has exercises
4. `/portal/nutrition-plan` — confirm today's meals load, toggling a meal updates macros and shows green state
5. `/portal/checkin` — confirm form config loads, submit a test check-in, confirm it saves
6. `/portal/progress` — confirm measurements list loads, save a dummy entry, delete it
7. `/portal/ai` — confirm SHIFT AI responds to "What training do I have today?" with the actual active plan

### Coach-side — use Gordy's admin account
1. `/admin` — confirm SHIFT AI briefing loads, stats accurate, Recent Check-Ins panel populated
2. `/admin/clients` — confirm filter rows work, tier counts match, At Risk combines red+amber
3. `/admin/clients/[id]` — confirm Week-at-a-Glance renders, tier chip visible, Coach Notes saves on blur
4. Admin AI — confirm "Are clients completing daily metrics?" returns data grounded in `daily_metrics_7d`

### Ops checks
1. Resend — send a test invite via `/admin/clients` "Add Client", confirm delivery
2. Push — enable notifications on the test client, send a nudge from admin, confirm the device receives it
3. Supabase auth — confirm a fresh signup flow works end-to-end

---

## 5. Rollback plan

If production is broken after deploy:

1. **Vercel rollback** — `vercel rollback <deployment-url>` or use the dashboard to promote the previous deployment. This is the fastest rollback for UI issues.
2. **Supabase migration rollback** — migrations are forward-only; if a new migration broke production, write a corrective forward migration. Keep the breaking migration out of `supabase/migrations/` until fixed.
3. **Push keys rollback** — VAPID keys can be rotated without data loss; subscriptions will re-register on next visit.
4. **Env vars** — Vercel env history: revert via dashboard, trigger a redeploy.

### iOS hosted-portal release control

The App Store binary opens the hosted portal at `https://app.onlinegordy.com/portal`. A Vercel rollback therefore changes what the installed iOS app displays immediately, even though the signed binary has not changed.

Before the final physical-device walkthrough, declare a short change freeze and record the tested Vercel deployment ID, Git SHA, iOS version/build and review-fixture check. Any later portal deployment invalidates that walkthrough and must be smoke-tested again before submission.

An App Store binary cannot be rolled back after release. If a native-only defect is found after approval, pause manual release in App Store Connect and upload a higher build. If already released, ship a corrected higher version/build; do not attempt to replace the accepted archive in place.

Never `git push --force` to `main` as a rollback. Revert commits instead.

---

## 6. Known dormant / partial launch surfaces

Not blockers, but worth knowing:
- `/portal/plan` — orphaned legacy coaching-plan page; not linked from nav, accessible via URL only. Data survives in `business_plans` table.
- `internal_notes` table — Coach Notes (`client_profiles.coach_notes`) is the active surface; legacy `internal_notes` table still exists in DB with no UI path for editing. Read-safe, write-dormant.
- `knowledge_chunks` — legacy SHIFT AI reference path. Current brain grounding uses `brain_docs` + `brain_chunks` from the reviewed SHIFT brain ingestion, and is treated as private context rather than quoted session material. Embeddings can use either `OPENROUTER_API_KEY` (`SHIFT_BRAIN_EMBEDDING_PROVIDER=openrouter`) or `OPENAI_API_KEY`.
- `values-determination` flow — builds to screen but hasn't had Gordy's final product sign-off.

### SHIFT AI — what's grounded vs what still wants live QA

Code-level QA for the Apr 21 late sprint is done (see roadmap for verdicts). Live-account QA is still a normal launch step. Gordy should eyeball these specifically:

- **"What training do I have today?" (client)** — the answer uses rotation (last completed session → next index), not weekday. Verify it matches what the client actually sees on `/portal/exercise-plan`. If a client hasn't logged anything, it should say "start at Day 1".
- **"What can I swap X with?" (client)** — the AI honestly flags that it doesn't see Gordy's full foods library, only the client's assigned meals. If Gordy wants richer swap suggestions, we'd need to feed the `foods` table into AI context. Until then, expect "swap for peanut butter, roughly the same macros, tell Gordy if you want it in your plan."
- **"Are they engaging or ghosting?" (admin)** — clients without an active training plan are now labelled `no_training_plan_assigned` and kept separate from "ghosting". Verify against at least one real no-plan client.
- **"Biggest risk with this client?" (admin)** — latest check-in (priority_message / support_ask / mood / replied) is now joined per-client, so the AI shouldn't cross-reference by name anymore. Verify on a Premium/VIP client who has an unreplied priority_message.
- **"Summarise this client in 5 bullets"** — expected shape: tier · goal + target_date · plans · adherence numbers + engagement_label · latest check-in standout. Reject any 3-bullet or 8-bullet answer.

### Demo-safe vs launch-safe (AI layer)

- Demo-safe: all ten QA prompt classes above return grounded answers on the seeded demo client.
- Launch-safe: the five admin-side prompts above have been eyeballed on each real client at least once, and the engagement_label matches operator intuition for every active client on the roster.

---

## 7. Quick reference — where things live

- App roadmap: `docs/app-store-roadmap.md`
- Supabase project: linked in `supabase/config.toml`
- Vercel project: `gordy-elliott-site` (see Vercel dashboard)
- Push keys: set in Vercel env; regenerate via `npx web-push generate-vapid-keys` if ever compromised
- Anthropic API: see `ANTHROPIC_API_KEY` in Vercel env; model used is `claude-haiku-4-5-20251001`

---

## 8. What "launch-safe" means for this repo

- Build passes (`npm run build` exit 0) on the deploy commit.
- Lint passes with zero errors on touched files.
- Every migration applied to production.
- Vercel env vars confirmed with the checks above.
- Smoke-test sequence above executed end-to-end and passes.
- At least one real client can complete the Monday → Sunday weekly flow without hitting a broken state.
- Gordy has personally walked through both client and admin on a phone.

Anything short of this is demo-safe, not launch-safe.

---

## 9. Demo-safe script (3–5 minute walkthrough for prospects / Gordy pitches)

Use a seeded Premium or VIP demo account. This sequence shows the product at its strongest without depending on a live real-time event.

1. **Open `/portal`** — point out: tier badge, Coach Priorities card, This Week summary, next check-in line, Upcoming event. Narrate: "this is their front door — the next action is always visible."
2. **Click Training Plan (`/portal/exercise-plan`)** — show the week strip, today's session, tap into a logged day to show the read-only view, then back to today. Narrate: "rotation-based, same session resumes wherever they left off."
3. **Tap Nutrition (`/portal/nutrition-plan`)** — show the macro donut, tap-to-log a meal, show the completed state updating macros in real time. Narrate: "not just a plan doc — it reacts to what they actually eat."
4. **Tap Check-in (`/portal/checkin`)** — show the tier-aware header, the priority_message / support_ask fields on Premium/VIP, and (if mid-week) the "already saved — you can update it" state.
5. **Tap SHIFT AI (`/portal/ai`)** — ask "what training do I have today?" — point out the grounded answer from the plan, not a generic reply.
6. **Switch to admin (`/admin`)** — show SHIFT AI admin briefing, recent check-in panel, the tier-sorted client list with At Risk filter.
7. **Open one client detail (`/admin/clients/[id]`)** — Week-at-a-Glance strip, Coach Notes, tier chip, Reply Queue. Narrate: "one screen per client, not a tabbed maze."
8. **Close in admin AI**: "summarise this client in 5 bullets" — show the grounded, tier-aware response.

If any step breaks, the session is not demo-safe yet.

---

## 10. Launch-safe smoke checklist (20–30 minute pass before announcing)

Use a real (not seeded) client account. Tick each line or the account is not launch-safe.

### Client-side weekly flow
- [ ] `/login` — sign-in works, no console errors.
- [ ] `/portal` — loads without errors, tier-aware hero renders, Coach Priorities section renders (empty or populated), This Week focus items render the correct count, next check-in date is correct for the client's `checkin_day`, Upcoming shows either the calendar event or a dashed empty state.
- [ ] `/portal` — click "Retry" after forcing an offline dashboard fetch (DevTools offline) — error banner appears; reload restores normal state.
- [ ] `/portal/exercise-plan` — today's session populates from rotation logic; logging a single set and clicking Save Session shows toast + persists on reload.
- [ ] `/portal/exercise-plan` — navigate to a past day; if not logged, verify the "Log retroactively" CTA works and saves to the correct date.
- [ ] `/portal/nutrition-plan` — tap-logging a plan meal increments macro totals and turns the card green; refreshing preserves state; navigating to yesterday shows yesterday's tracking, not today's.
- [ ] `/portal/nutrition-plan` — add a food via Food Browser; add a manual meal; verify both show in Tracked Meals and contribute to macros.
- [ ] `/portal/checkin` — submit a test check-in; the form switches to "Check-in Saved"; "Keep Editing" returns to the form with values prefilled; update and re-submit shows the "updated" toast rather than the "saved" toast.
- [ ] `/portal/checkin` — Premium/VIP priority_message + support_ask fields save and are visible to the coach in `/admin/clients/[id]`.
- [ ] `/portal/progress` — add a measurement entry (date + weight + one measurement); it appears in Recent Entries and in the chart; delete clears it everywhere.
- [ ] `/portal/ai` — "what training do I have today?" returns a plan-grounded answer, not "I don't know".
- [ ] `/portal/ai` — "swap almond butter" returns honest-framed swap guidance, not fake foods-library claims.
- [ ] Mobile (real phone, not simulator): bottom nav does not overlap content; safe-area-inset respects iPhone home indicator; sticky Save button on check-in sits above the keyboard; no horizontal scroll on any portal route.

### Coach-side daily flow
- [ ] `/admin` — SHIFT AI briefing loads without 500, Recent Check-Ins panel populated, no console errors.
- [ ] `/admin/clients` — filter rows work (All / At Risk / VIP / Premium); counts match the filtered list; clicking a row navigates to detail.
- [ ] `/admin/clients/[id]` — Week-at-a-Glance renders with correct Sessions Logged, Check-in status, Open Priorities, Reply Queue age; tier chip is correct.
- [ ] `/admin/clients/[id]` — Coach Notes saves on blur (not just on explicit save) and persists across reload.
- [ ] `/admin/clients/[id]` — changing check-in form template updates the client; portal-side `/portal/checkin` reflects the new form after one reload.
- [ ] `/admin/clients/[id]` — reply to an unreplied check-in; the client's `/portal` "Latest Reply" card reflects the new reply.
- [ ] `/admin/clients/[id]` — assign an exercise plan + nutrition plan; the client's `/portal/exercise-plan` + `/portal/nutrition-plan` show them on next reload.
- [ ] `/admin/ai` — admin AI answers "who needs attention most today?" with real client names, not generic text.
- [ ] `/admin/ai` — admin AI answers "who's slipping but not ghosting?" by correctly distinguishing `slipping` (1-2 sessions) from `ghosting` (0 sessions, has active plan) and `no_training_plan_assigned`.
- [ ] `/admin/ai` — admin AI drafting a reply produces Gordy-voiced output (4-8 sentences, direct, grounded in priority_message / support_ask).
- [ ] `/admin/checkin-forms` — create a new template, assign to one test client, verify fallback if a client has no assigned form.

### Ops checks (external dependencies)
- [ ] Resend — send a test invite from `/admin/clients` Add Client; email lands within 30s, magic link works.
- [ ] Push — enable notifications on a test client; send a nudge from admin; device receives it within 15s.
- [ ] Supabase — confirm `supabase/migrations/` has zero pending migrations against production.
- [ ] Vercel env — every variable in section 1 confirmed set in both Preview and Production.
- [ ] Storage key — `gordy-portal-roadmap-progress-v8` is active in the roadmap HTML and seededComplete reflects reality.

If any line is unchecked, the release is demo-safe only.

---

## 11. Gordy's 20-minute sign-off walkthrough (g5-9)

This is the real-device/real-account walkthrough Gordy runs himself before giving the release green light. Tick every line or the product is not sign-off ready.

**Setup (do once):**
- [ ] On iPhone, open Safari → `https://app.onlinegordy.com/portal` → sign in as your own test-client account (or a real client with permission).
- [ ] Install to home screen: Share → "Add to Home Screen". Confirm the app icon is correct, the splash background is dark (not white — fixed this sprint), and the status bar isn't clipped.
- [ ] Launch from the home-screen icon. Confirm it opens in standalone mode (no browser chrome).

**Client-side (from the home-screen icon, phone only):**
- [ ] `/portal` — tier badge reads the right tier, Coach Priorities card renders, This Week focus count is correct, next check-in date is the right weekday.
- [ ] `/portal/exercise-plan` — today's session loads. Log one set of one exercise. Scroll down — the **sticky Save Session bar** stays above the bottom nav. Tap Save. Timestamp appears under the header. Pull to refresh — the log is still there. Tap Save again — no double-log.
- [ ] `/portal/exercise-plan` — with the keyboard open typing into a reps input, the sticky Save bar does not overlap the keyboard or hide behind it.
- [ ] `/portal/exercise-plan` — navigate to yesterday (past day). "Retro log" mode label appears. Save a retroactive log. Confirm it persists to the right date.
- [ ] `/portal/nutrition-plan` — tap one plan meal's Log button. Macro donut updates. Card goes green. Refresh — state persists.
- [ ] `/portal/nutrition-plan` — open Food Browser. Search. Add a food. Confirm the iPhone home indicator doesn't clip the bottom of the scroll list.
- [ ] `/portal/checkin` — submit a check-in. If photos attached and one fails, confirm the error toast explicitly tells you how many photos didn't upload.
- [ ] `/portal/checkin` — submit a check-in then tap Keep Editing — confirm values are prefilled, resubmit shows "updated" toast not "saved" toast.
- [ ] `/portal/progress` — save a measurement entry. Confirm timestamp on the success message. Delete it — it vanishes from Recent Entries and the chart.
- [ ] `/portal/ai` — ask "what training do I have today?". Confirm the answer references the actual active plan (not generic). With the keyboard open the textarea stays visible and the bottom nav doesn't clip it.
- [ ] `/portal/ai` — ask "swap almond butter". Confirm the AI gives honest swap framing (not pretending a full foods library is in scope).
- [ ] Overall: no horizontal scroll on any page. No broken card edges. No white-flash when switching dark-mode pages.

**Coach-side (can be on laptop, but spot-check one view on phone):**
- [ ] `/admin` — SHIFT AI briefing loads, Recent Check-Ins panel populated.
- [ ] `/admin/clients` — filters work, tier counts right, At Risk shows who you'd expect.
- [ ] `/admin/clients/[id]` — Week-at-a-Glance numbers match what the client just logged above. Assign a plan → client sees it on next reload.
- [ ] `/admin/clients/[id]` — reply to the check-in you just submitted. The reply surfaces on the client's `/portal` on next reload.
- [ ] `/admin/ai` — ask "who needs attention most today?". Names in the answer match your own intuition for the real roster. If any name is surprising in a way that feels wrong, flag it — that's a grounding bug.
- [ ] `/admin/checkin-forms` — per-client override flow: open a client, click Customise, save as new. Template is created and auto-assigned to that client only.

**Greenlight criteria:** every line ticked AND no surprises during the walkthrough. Anything surprising is either a bug report or a roadmap gap that reopens.

---

## 12. Preview vs production parity — concrete checks

Before promoting a preview deploy to production, run these in the Vercel dashboard + Supabase + a fresh browser:

- [ ] Vercel Production env vars — every var in §1 present, no `NEXT_PUBLIC_*` wrapping around a service-role key.
- [ ] Vercel Preview env vars — same set (VAPID key parity especially matters — mismatched keys break push subscriptions silently on cutover).
- [ ] Supabase project — `supabase/config.toml` points at the linked project; `supabase db diff --linked` shows zero drift.
- [ ] Supabase migrations — `supabase migration list --linked` shows the same list as `supabase/migrations/` with no pending rows.
- [ ] Resend — `RESEND_FROM_EMAIL` domain is verified in the Resend dashboard; send one test to yourself from `/admin/clients` Add Client.
- [ ] Anthropic — `ANTHROPIC_API_KEY` is set and has credit; `/admin/ai` and `/portal/ai` both answer at least once.
- [ ] Push — enable notifications on a production client account; send a nudge from admin; device receives within 15s. If not, VAPID keys differ between envs.
- [ ] Manifest — curl `https://app.onlinegordy.com/manifest.json` and confirm `start_url: "/portal"`, `theme_color: "#0A0A0A"` (not the old `#ffffff`), and `shortcuts` array present.
- [ ] Service worker — `https://app.onlinegordy.com/sw.js` resolves to 200 and the version string matches the current deploy.
- [ ] Site URL — `NEXT_PUBLIC_SITE_URL` matches production domain so OG + email links don't point at preview.

Any mismatch here is a launch blocker. Fix before announcing.
