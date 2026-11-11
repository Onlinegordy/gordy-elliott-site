import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inboxThreadUrl = new URL("../components/inbox/InboxThread.tsx", import.meta.url);
const portalHomeUrl = new URL("../app/portal/page.tsx", import.meta.url);
const fixtureCheckerUrl = new URL("../scripts/check-app-review-fixture.mjs", import.meta.url);
const fixtureRefreshUrl = new URL("../scripts/refresh-app-review-fixture.mjs", import.meta.url);
const metadataUrl = new URL("../docs/app-store-metadata.md", import.meta.url);
const privacyUrl = new URL("../app/privacy/page.tsx", import.meta.url);
const browserVerifierUrl = new URL("../scripts/verify-app-store-release.mjs", import.meta.url);

test("release UI uses durable update wording instead of TestFlight copy", async () => {
  const inboxThread = await readFile(inboxThreadUrl, "utf8");
  assert.doesNotMatch(inboxThread, /TestFlight/i);
  assert.match(inboxThread, /latest available version/);
  assert.match(inboxThread, /newer version of AT CAPACITY/);
});

test("Home only requests weekly capacity for an explicit Founder experience", async () => {
  const portalHome = await readFile(portalHomeUrl, "utf8");
  assert.match(portalHome, /if \(!isFounderExperience\(profile\.experience_mode\)\)/);
  assert.ok(
    portalHome.indexOf("isFounderExperience(profile.experience_mode)")
      < portalHome.indexOf('fetch("/api/portal/weekly-capacity")'),
  );
  assert.equal(portalHome.match(/fetch\("\/api\/portal\/weekly-capacity"\)/g)?.length, 1);
});

test("review fixture checks the exact programme, onboarding and wearable state", async () => {
  const checker = await readFile(fixtureCheckerUrl, "utf8");
  assert.match(checker, /programme_type === "capacity"/);
  assert.match(checker, /onboarding_status === "active"/);
  assert.match(checker, /\.from\("client_wearable_connections"\)/);
  assert.match(checker, /\.in\("status", \["pending", "error"\]\)/);
  assert.match(checker, /unhealthyWearableConnections\.length === 0/);
});

test("guarded fixture refresh repairs reviewer state without deleting connected wearables", async () => {
  const refresh = await readFile(fixtureRefreshUrl, "utf8");
  assert.match(refresh, /app_review_fixture !== true/);
  assert.match(refresh, /CONFIRM_APP_REVIEW_FIXTURE_REFRESH/);
  assert.match(refresh, /\.update\(\{ programme_type: "capacity", onboarding_status: "active" \}\)/);
  assert.match(refresh, /\.from\("client_wearable_connections"\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\("client_id", profile\.id\)[\s\S]*?\.in\("status", \["pending", "error"\]\)/);
  assert.doesNotMatch(refresh, /\.in\("status", \[[^\]]*"connected"/);
});

test("prepared review notes contain no unverified provider or TestFlight claims", async () => {
  const metadata = await readFile(metadataUrl, "utf8");
  assert.doesNotMatch(metadata, /Oura has completed|MyFitnessPal must complete|Production browser QA passed|Exact TestFlight|Google Calendar OAuth branding.*approved/i);
  assert.match(metadata, /Submission hold:/);
  assert.match(metadata, /do not copy these notes into App Store Connect or submit the app/i);
});

test("privacy policy identifies the controller, lawful bases, ICO right and Apple notification processor", async () => {
  const privacy = await readFile(privacyUrl, "utf8");
  assert.match(privacy, /RENDEZVOUS 1 LIMITED, operating AT CAPACITY through Gordon Elliott, is the data controller/);
  assert.match(privacy, /processed to provide the coaching service/);
  assert.match(privacy, /explicit consent collected in the app/);
  assert.match(privacy, /Information Commissioner/);
  assert.match(privacy, /https:\/\/ico\.org\.uk\/make-a-complaint\//);
  assert.match(privacy, /Apple Push Notification service/);
});

test("reviewer browser verification has a production-safe read-only mode", async () => {
  const verifier = await readFile(browserVerifierUrl, "utf8");
  assert.match(verifier, /PORTAL_QA_READ_ONLY === "true"/);
  assert.match(verifier, /SKIP native push write contract/);
  assert.match(verifier, /if \(readOnly\)[\s\S]*?else \{[\s\S]*?context\.request\.post/);
});
