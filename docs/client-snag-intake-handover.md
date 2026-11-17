> **Release update — 5 October 2026:** the browser form is now live at https://app.onlinegordy.com/support/report. Reviewed runtime revision `5890fa0`, deployment `dpl_DbGQb8brTFTKtYsdaHGpeWyxJ5Ty`. Both support migrations have been applied to the verified Gordy project. The original implementation notes below describe the earlier source-only state.
>
> A deployed fictional report with screenshot completed submission, deduplicated receipt, authenticated Kevin admin queue read, private JPEG preview, notification delivery-state persistence and closure with owner/notes/resolution. Resend accepted the email to kevin@flowstatesystems.ai; inbox delivery has not been independently confirmed. A repeat notification run sent nothing. The public customer URL was inspected in the in-app browser signed out, and its owned tab was closed and absence verified. No physical iOS device was exercised.
>
> Vercel checks for pending notification emails every five minutes. Support investigation and production releases are separate operational steps. Reports are treated as untrusted customer data.
>
> The first candidate failed on a missing Sharp/libvips shared library. Explicit route tracing plus deferred guarded image import fixed the deployed fault. Nine focused tests, TypeScript and both notification and packaging reviews pass. The prior implementation’s 263 contract checks remain supporting evidence. The previous localhost demo no longer has a listener on 3147. No live app-store release or Android build was performed.

# AT CAPACITY client snag intake

Prepared 5 October 2026. Implemented on `codex/client-snag-intake`, based on `origin/main` revision `bf364efc33146e6eee0c464b0a61359a690bbcb1`.

## What is ready

- Branded `/support/report` form available without signing in, including contact details, affected area, description, impact, optional expected behaviour/page and optional screenshot. No account lookup or access is granted from an unverified email.
- Settings and public Support link directly to the reporting form. Coaching questions continue through DM.
- Private `/admin/support` queue using existing admin authorisation, with owner, priority, status, internal notes and resolution/retest steps. Filtering runs before paginated queries; each persisted update reloads the filtered view from page zero so closed/reopened reports remain reachable. Editable fields lock during save; optimistic updates reject concurrent changes.
- Durable, service-only report intake and request quotas; one receipt per submission key. A screenshot is optional and private, validated/re-encoded as JPEG without source metadata. A failed attachment does not lose the written report. Storage has a restrictive guard that denies client/anonymous access even alongside legacy permissive policies.
- Privacy wording describes support reports and restricted access. No notification, email, push, n8n workflow or client message is triggered by submission or triage.

## Review preview

Run `SUPPORT_DEMO=true NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=demo-anon-key npm run dev -- --hostname 127.0.0.1 --port 3147`, then visit `http://127.0.0.1:3147/support/demo`.

The demo has a clearly labelled fictional report and two tabs. Submit a new fictional report, switch to Support queue, assign an owner/priority and save retest notes. Refreshing clears the demo. It does not invoke the report APIs or database. The demo route returns 404 outside development, even if SUPPORT_DEMO is set.

The real public form at `/support/report` also renders locally. With the dummy configuration, submitting shows a retry/email fallback rather than writing anywhere. Do not use real client information in this local demo.

## Verification

- `npm run test:support`: six focused tests passed; actual submission handler against a local PostgREST fixture backed by the real migration in PGlite; private storage/access guards, admission and report quotas, idempotency, screenshot sanitisation, invalid/disguised files, upload/link failures, cross-origin and oversized requests. Includes older unresolved reports beneath 250 newer resolved reports and disjoint query pages.
- `npm run test:release-contracts`: 263 existing tests passed.
- `npx tsc --noEmit`: passed.
- Scoped ESLint: zero errors, one existing Settings image warning.
- `npm run build`: passed with dummy local Supabase settings; no external backend request or credentials required.
- Browser: fictional submission/receipt and queue assignment/priority/retest notes inspected at 390×844 and 1440×1000; no horizontal overflow. Public form opened signed out. A Chrome extension added `data-sharkid` attributes before hydration, producing one extension-related React warning; it was not suppressed. The first failure-state screenshot predates the corrected dev host comparison; direct HTTP retest confirms a valid local Origin now reaches the intended 503 save fallback.
- Temporary production server smoke: `/support/report` returned 200, `/support/demo` returned 404 even with SUPPORT_DEMO=true, and `/api/admin/support` returned 401. The server was terminated and port 3148 absence verified.
- Final code review found no actionable issues. Accepted fixes covered server filtering/pagination, post-save refresh including closure/reopening, locking edits during save, pre-image request limiting and keeping the fictional demo entirely in memory.
- Signed-out admin queue GET and PATCH return 401. Anonymous/authenticated roles cannot read report rows or invoke either RPC; neither can access the private screenshot bucket, even with a synthetic legacy permissive policy.

Verification screenshots and logs are retained separately from the application repository.

## Coordinated release sequence

1. Review this branch and choose the named Flowstate triage/holiday-cover owner. Verify existing authorised admin access; this task provisions no new admin account.
2. Apply only `supabase/migrations/20261005093000_support_reports.sql` to the verified Gordy Supabase project `yeflmlcpqdfsfjlxofqy`. Confirm current migration history first. This has NOT been applied to production.
3. Deploy the reviewed web revision to Gordy's `gordy-elliott-site` project and verify the exact `app.onlinegordy.com` alias/revision. Deploy from the reviewed clean checkout.
4. With a permitted fictional report, check durable submission → receipt → admin queue → owner/notes → retest/resolution; verify anonymous/client isolation and private screenshots. Use a disposable test identity/contact; avoid altering any real client account or content.
5. Open Settings → Report an app problem on the actual distributed iOS build; check same-host navigation, keyboard, screenshot picker and return to app. No Swift/binary changes were made here. Store approval/manual-release is a separate launch task.
6. Once verified, use the client instructions below and share the form link. This task has sent no instructions or notifications.

The quotas assume the current Vercel deployment, where client forwarding headers are platform-controlled ([request-header documentation](https://vercel.com/docs/headers/request-headers)). If hosting/proxy configuration changes, recheck that trust boundary.

## Client instructions — use after release

“If something in AT CAPACITY is not working as expected, open Settings → Report an app problem, or visit https://app.onlinegordy.com/support/report. Tell us what you were trying to do, what happened and whether it blocks you. A screenshot helps, but is optional; crop out unrelated personal information. The report goes directly to the app support team and gives you a reference for follow-up. Keep using your DM with Gordy for coaching questions. If the form cannot send, email kevin@flowstatesystems.ai.”

## Remaining limits

Production schema/deployment, a live fictional report walkthrough, actual-device navigation and holiday-cover ownership are still open. Earlier responsive checks and final API/SQL/build checks are recorded separately. Automated notifications are not configured; the owner needs to check the queue directly during launch. The inspected source contains no Android build; Google Play onboarding and Android implementation are separate.
