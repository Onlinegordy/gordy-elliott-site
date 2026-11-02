import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canApplyTerraUserEvent, isTerraConnectionAttemptExpired, matchesTerraConnectionAttempt, TERRA_PENDING_TIMEOUT_MS } from "@/lib/terra/events";
import { generateTerraWidgetSession, getTerraUsersByReferenceId, selectTerraUserForConnection, type TerraUser } from "@/lib/terra/client";

const referenceId = "client:00000000-0000-0000-0000-000000000001";
const attempt = "2026-10-07T08:28:00.000Z";
const user: TerraUser = {
  user_id: "23dc2540-7139-44c6-8158-f81196e2cf2e",
  reference_id: referenceId,
  provider: "MYFITNESSPAL",
  active: true,
};

async function withTerraConfig(action: () => Promise<void>) {
  const saved = { devId: process.env.TERRA_DEV_ID, apiKey: process.env.TERRA_API_KEY, siteUrl: process.env.NEXT_PUBLIC_SITE_URL };
  process.env.TERRA_DEV_ID = "testing-dev";
  process.env.TERRA_API_KEY = "testing-key";
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
  try { await action(); }
  finally {
    for (const [key, value] of [["TERRA_DEV_ID", saved.devId], ["TERRA_API_KEY", saved.apiKey], ["NEXT_PUBLIC_SITE_URL", saved.siteUrl]]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

test("pending attempts expire from consent time even if metadata was updated; other states stay intact", () => {
  const start = Date.parse(attempt);
  const connection = { status: "pending", consented_at: attempt, updated_at: new Date(start + 14 * 60_000).toISOString() };
  assert.equal(isTerraConnectionAttemptExpired(connection, start + TERRA_PENDING_TIMEOUT_MS - 1), false);
  assert.equal(isTerraConnectionAttemptExpired(connection, start + TERRA_PENDING_TIMEOUT_MS), true);
  assert.equal(isTerraConnectionAttemptExpired({ status: "pending", updated_at: attempt }, start + TERRA_PENDING_TIMEOUT_MS), true);
  assert.equal(isTerraConnectionAttemptExpired({ status: "pending", updated_at: "invalid" }, start), true);
  for (const status of ["connected", "error", "disconnected"]) assert.equal(isTerraConnectionAttemptExpired({ ...connection, status }, start + 365 * 86400_000), false);
});

test("only the current consent timestamp can cancel an attempt, across equivalent database timestamp formats", () => {
  assert.equal(matchesTerraConnectionAttempt("2026-10-07T08:28:00+00:00", attempt), true);
  assert.equal(matchesTerraConnectionAttempt(attempt, "2026-10-07T08:29:00Z"), false);
  assert.equal(matchesTerraConnectionAttempt(attempt, undefined), false);
  assert.equal(matchesTerraConnectionAttempt("invalid", "invalid"), false);
});

test("reconciliation requires verified identity/provider and positive provider state; ambiguity cannot connect", () => {
  assert.equal(selectTerraUserForConnection([user], "myfitnesspal", referenceId), user);
  for (const invalid of [
    { ...user, reference_id: null }, { ...user, reference_id: "client:someone-else" },
    { ...user, provider: "GARMIN" }, { ...user, active: false }, { ...user, active: undefined },
    { ...user, is_authenticated: false },
  ]) assert.equal(selectTerraUserForConnection([invalid], "myfitnesspal", referenceId), null);
  assert.equal(selectTerraUserForConnection([user, { ...user, user_id: "other" }], "myfitnesspal", referenceId), null);
  assert.equal(selectTerraUserForConnection([user], "myfitnesspal", referenceId, { expectedTerraUserId: "another-client-user" }), null);
});

test("a reconnect cannot verify solely from the stored previous user; a verified returned user or reauth can", () => {
  assert.equal(selectTerraUserForConnection([user], "myfitnesspal", referenceId, { previousTerraUserId: user.user_id }), null);
  assert.equal(selectTerraUserForConnection([user], "myfitnesspal", referenceId, { previousTerraUserId: user.user_id, expectedTerraUserId: user.user_id, attemptStartedAt: attempt }), user);
  const historic = { ...user, created_at: "2026-08-05T10:00:00Z" };
  assert.equal(selectTerraUserForConnection([historic], "myfitnesspal", referenceId, { attemptStartedAt: attempt }), null);
  assert.equal(selectTerraUserForConnection([historic], "myfitnesspal", referenceId, { expectedTerraUserId: user.user_id, attemptStartedAt: attempt }), historic);
  // Terra does not always include created_at. Its absence alone must not reject a verified return.
  assert.equal(selectTerraUserForConnection([user], "myfitnesspal", referenceId, { expectedTerraUserId: user.user_id, attemptStartedAt: attempt }), user);
});

test("historical data and late prior-user revocations cannot complete or break a replacement", () => {
  assert.equal(canApplyTerraUserEvent("data", "pending", "old-user", ["old-user"]), false);
  assert.equal(canApplyTerraUserEvent("data", "pending", "old-user", ["new-user"]), true);
  assert.equal(canApplyTerraUserEvent("error", "connected", "new-user", ["old-user"]), false);
  assert.equal(canApplyTerraUserEvent("disconnect", "connected", "new-user", ["old-user"]), false);
  assert.equal(canApplyTerraUserEvent("disconnect", "connected", "new-user", ["new-user"]), true);
  assert.equal(canApplyTerraUserEvent("connect", "error", "old-user", ["new-user", "old-user"]), false);
  assert.equal(canApplyTerraUserEvent("connect", "disconnected", "old-user", ["new-user"]), false);
});

test("Terra lookup rejects explicit unauthenticated/error responses and foreign or missing reference ids", async () => {
  await withTerraConfig(async () => {
    assert.deepEqual(await getTerraUsersByReferenceId(referenceId, async () => json({ status: "success", is_authenticated: false, user })), []);
    await assert.rejects(getTerraUsersByReferenceId(referenceId, async () => json({ status: "error", message: "Failed upstream" })), /Failed upstream/);
    const users = await getTerraUsersByReferenceId(referenceId, async () => json([user, { ...user, reference_id: null }, { ...user, reference_id: "client:other" }]));
    assert.deepEqual(users, [user]);
    const authenticated = await getTerraUsersByReferenceId(referenceId, async () => json({ status: "success", is_authenticated: true, user: { ...user, active: undefined } }));
    assert.equal(selectTerraUserForConnection(authenticated, "myfitnesspal", referenceId)?.is_authenticated, true);
  });
});

test("new browser and native sessions carry the attempt timestamp and reject malformed provider sessions", async () => {
  await withTerraConfig(async () => {
    for (const nativeReturn of [false, true]) {
      let submitted: Record<string, string> = {};
      await generateTerraWidgetSession("00000000-0000-0000-0000-000000000001", "myfitnesspal", {
        nativeReturn, attemptStartedAt: attempt,
        fetchImpl: async (_url, init) => {
          submitted = JSON.parse(String(init?.body));
          return json({ status: "success", url: "https://widget.tryterra.co/session/test" });
        },
      });
      for (const key of ["auth_success_redirect_url", "auth_failure_redirect_url"]) {
        const redirect = new URL(submitted[key]);
        assert.equal(redirect.searchParams.get("attempt"), attempt);
        assert.equal(redirect.searchParams.get("provider"), "myfitnesspal");
        assert.equal(redirect.pathname, nativeReturn ? "/connected-app-return" : "/portal/connected-apps");
      }
    }
    for (const payload of [{ status: "error" }, {}, { url: "javascript:alert(1)" }, { url: "https://foreign.example/session" }]) {
      await assert.rejects(generateTerraWidgetSession("00000000-0000-0000-0000-000000000001", "myfitnesspal", { fetchImpl: async () => json(payload) }));
    }
  });
});

test("consent remains visible and checked after acceptance and enables the available Connect buttons", async () => {
  // tsx's standalone JSX transform uses React; Next's production transform supplies it automatically.
  Object.assign(globalThis, { React });
  const { default: Panel } = await import("@/components/portal/WearableConnectionsPanel");
  const props = { connections: [], consentAccepted: false, available: true, mockMode: false, whoopAvailable: false, garminAvailable: true, connecting: null, disconnecting: null, onConsentChange: () => {}, onConnect: () => {}, onDisconnect: () => {}, onBack: () => {} };
  const unchecked = renderToStaticMarkup(React.createElement(Panel, props));
  const checked = renderToStaticMarkup(React.createElement(Panel, { ...props, consentAccepted: true }));
  assert.match(unchecked, /Tick the checkbox to enable Connect/);
  assert.match(checked, /Permission confirmed/);
  assert.match(checked, /type="checkbox"[^>]*checked=""/);
  assert.match(checked, /aria-describedby="health-consent-status"/);
  assert.match(checked, /I consent to AT CAPACITY receiving health data/);
  assert.equal((unchecked.match(/disabled=""/g) || []).length, 4);
  assert.equal((checked.match(/disabled=""/g) || []).length, 0);
  const starting = renderToStaticMarkup(React.createElement(Panel, { ...props, consentAccepted: true, connecting: "garmin" }));
  assert.equal((starting.match(/disabled=""/g) || []).length, 4);
});

test("existing native connections retain their Disconnect control when changing phone platform", async () => {
  Object.assign(globalThis, { React });
  const { default: Panel } = await import("@/components/portal/WearableConnectionsPanel");
  for (const [nativeHealth, provider, name] of [["healthconnect", "apple", "Apple Health"], ["apple", "healthconnect", "Health Connect"]] as const) {
    const connection = { id: "existing", client_id: "demo", provider, status: "connected" as const, terra_user_id: null, reference_id: "client:demo", last_sync_at: null, connected_at: attempt, disconnected_at: null };
    const props = { connections: [connection], nativeHealth, consentAccepted: true, available: true, mockMode: false, whoopAvailable: false, connecting: null, disconnecting: null, onConsentChange: () => {}, onConnect: () => {}, onDisconnect: () => {}, onBack: () => {} };
    const markup = renderToStaticMarkup(React.createElement(Panel, props));
    const row = markup.match(/<article[\s\S]*?<\/article>/g)?.find(article => article.includes(name));
    assert.ok(row, `${name} remains visible on the other phone platform`);
    assert.match(row, /Disconnect/);
    const fresh = renderToStaticMarkup(React.createElement(Panel, { ...props, connections: [] }));
    assert.doesNotMatch(fresh, new RegExp(`<h3[^>]*>${name}</h3>`));
  }
});

test('paused Garmin and reason transitions are wired through server and visible panel', async()=>{
 const fs=await import('node:fs');
 const source=(p:string)=>fs.readFileSync(p,'utf8');
 assert.match(source('app/api/portal/integrations/terra/session/route.ts'),/provider === "garmin" && !getTerraConfig\(\).garminEnabled/);
 assert.match(source('app/api/portal/integrations/terra/session/route.ts'),/failure_reason: "widget_return_failed"/);
 assert.match(source('app/api/portal/integrations/terra/session/route.ts'),/failure_reason: null/);
 assert.match(source('app/api/portal/integrations/route.ts'),/failure_reason: "attempt_expired"/);
 const webhook=source('app/api/integrations/terra/webhook/route.ts');
 for(const reason of ['provider_auth_error','provider_revoked','provider_deauth','orphan_reference'])assert.ok(webhook.includes(reason));
 Object.assign(globalThis,{React});const {default:Panel}=await import('@/components/portal/WearableConnectionsPanel');
 const html=renderToStaticMarkup(React.createElement(Panel,{connections:[],consentAccepted:true,available:true,mockMode:false,whoopAvailable:false,garminAvailable:false,connecting:null,disconnecting:null,onConsentChange:()=>{},onConnect:()=>{},onDisconnect:()=>{},onBack:()=>{}}));
 assert.match(html,/Garmin has paused new third-party connections/);
});

test("native connection failures do not claim provider refusal in the visible connection card", async () => {
 Object.assign(globalThis, { React });
 const { default: Panel } = await import("@/components/portal/WearableConnectionsPanel");
 for (const provider of ["apple", "healthconnect", "fitbit"]) {
  const connection = { id: "failed", client_id: "demo", provider, status: "error" as const, terra_user_id: null, reference_id: "client:demo", last_sync_at: null, connected_at: null, disconnected_at: null, failure_reason: "widget_return_failed" };
  const html = renderToStaticMarkup(React.createElement(Panel, { connections: [connection], nativeHealth: provider === "healthconnect" ? "healthconnect" : "apple", consentAccepted: true, available: true, mockMode: false, whoopAvailable: false, connecting: null, disconnecting: null, onConsentChange: () => {}, onConnect: () => {}, onDisconnect: () => {}, onBack: () => {} }));
  if (provider === "fitbit") assert.match(html, /The provider did not approve the connection/);
  else {
   assert.match(html, /The health connection wasn/);
   assert.doesNotMatch(html, /The provider did not approve the connection/);
  }
 }
});
