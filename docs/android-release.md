# AT CAPACITY Android release

Package: `com.gordyelliott.atcapacity`. Initial Android version: `1.0.0` / code `1`, independently versioned from iOS. Server: `https://app.onlinegordy.com`.

## Build storage

Run from a repository checkout on the configured external build disk. `scripts/android-environment.mjs` validates the disk and places all heavy storage there; it never repurposes HOME or changes global shell settings.

| Content | Location |
| --- | --- |
| Android SDK | `/Volumes/CodexDev/Developer-Tools/Android/sdk` |
| JDK21 | `/Volumes/CodexDev/Developer-Tools/Java/temurin-21` |
| Gradle and downloaded wrapper | `/Volumes/CodexDev/Developer-Caches/gradle` |
| npm | `/Volumes/CodexDev/Developer-Caches/npm` |
| Android settings, emulator and AVD | `Developer-Caches/android-user`, `android-emulator`, `android-avd` on CodexDev |
| Temporary build/download files | `/Volumes/CodexDev/Developer-Caches/android-tmp` |
| APK, AAB, intermediate build output | Worktree `android/app/build` on CodexDev |
| Private upload signing | `/Volumes/CodexDev/Projects/AT-CAPACITY-Releases/android/signing` |

Two Gradle workers, 1536 MB heap and no persistent daemon keep resource use bounded. Builds fail if the disk is unavailable instead of falling back to the internal drive. Small OS credential or adb settings may remain on the Mac. No launchd paths have moved.

## Commands

- `npm run android:tools -- --accept-license`: install checksum-verified Google command-line tools and SDK36 after explicit licence approval.
- `npm run android:assets`: generate Android sizes from the existing ATC brand icon.
- `npm run android:sync`: prepare the HTTPS production shell and copy native assets/plugins.
- `npm run android:build`: compile the debug APK (Firebase may be absent; such a build does not prove push works).
- `npm run android:lint`: Android lint.
- `npm run android:key`: generate a private upload key once; existing files are never overwritten. Back up the keystore and signing configuration securely before release.
- `npm run android:bundle`: validate Firebase/signing, sync and generate the signed release AAB plus a matching installable release APK for physical-device QA.
- `npm run test:android`: Android token, payload, certificate, privacy/reporting, migration/RLS and provider-selection contracts.

SDK command-line tools, platform36 and build tools36 were installed on CodexDev on 6 October 2026 after Kevin authorised licence acceptance. The compatibility path `Java/temurin-21` now points to the full Amazon Corretto 21.0.12.1 JDK at `Java/amazon-corretto-21.jdk/Contents/Home`. The previously reused extension runtime lacked `jlink` and could not compile Android; its original files are untouched. Build checks require `javac`, `jlink` and Java modules. No full Android Studio installation is needed for CLI compilation.

The installed ARM64 JDK archive came from Amazon's [official download](https://corretto.aws/downloads/resources/21.0.12.12.1/amazon-corretto-21.0.12.12.1-macosx-aarch64.tar.gz), with SHA256 `8594556550766865662411ef3a7a71a66df9a9065f28a7b318a5352bda91b6a4` verified against the [official release](https://github.com/corretto/corretto-21/releases/tag/21.0.12.12.1). Installation evidence is outside Git at `Projects/AT-CAPACITY-Releases/android/java-install.json` on CodexDev.

## Required Firebase configuration

Dedicated Firebase project `at-capacity-gordy` (number `160097237776`) was created on 6 October 2026 under Kevin's existing Google account after explicit Firebase terms approval. Firebase confirms the Spark no-cost plan; the automatically attached Google Cloud billing link was removed before Firebase activation. Analytics is disabled. Android app `AT CAPACITY Android` is registered as `com.gordyelliott.atcapacity` (Firebase app ID `1:160097237776:android:60ea0889bce7fb7f384395`). Gordy's ownership access will need arranging separately. Do not use the other similarly named Cloud project `at-capacity-503314` or enable billing for messaging.

Client configuration was downloaded by Kevin and validated against the registered package/project. It is stored outside Git at `/Volumes/CodexDev/Projects/AT-CAPACITY-Releases/android/firebase/google-services.json` and supplied through `ANDROID_GOOGLE_SERVICES_FILE`.

After explicit approval, service account `at-capacity-android-push@at-capacity-gordy.iam.gserviceaccount.com` was created with only the project-scoped `roles/firebasecloudmessaging.admin` role. Its private JSON is stored with owner-only permissions outside Git. `FCM_SERVICE_ACCOUNT_JSON` is saved as an encrypted, sensitive **Production** environment variable in the verified `gordy-elliott-site` Vercel project; it takes effect on the next deployment. A Google FCM dry run reached the provider and rejected a deliberately synthetic token as unregistered, without sending any notification. This verifies authentication/provider access, not installed-device delivery. The Android device migration was applied to production on 6 October 2026; all 15 existing iPhone device records were preserved, RLS remained enabled, and browser roles still lack table access. Backend deployment is tracked separately in the release handover.

The setup and remaining delivery steps are:

1. Register Android package `com.gordyelliott.atcapacity` in that project.
2. Download `google-services.json` and keep it outside Git. Set `ANDROID_GOOGLE_SERVICES_FILE` to the file; sync copies it to ignored `android/app/google-services.json`.
3. Configure production `FCM_SERVICE_ACCOUNT_JSON` with a service account authorised to send FCM for that same project. This is server-only and must never appear in the app bundle, public environment variables, logs or Git.
4. Apply `20261006120000_android_push_devices.sql` before deploying Android registration/delivery code. It preserves service-role-only access and existing APNs upsert compatibility.
5. Native delivery routes iOS records through APNs and Android records through FCM. Web fallback remains after no native delivery; credential/payload/project failures do not disable valid devices.
6. Test permission denial, permission grant, foreground/background delivery, notification tap, sign-out and account switching using a dedicated fixture. FCM defaults to the `coaching_updates` channel with the ATC notification icon. No Firebase Analytics SDK is added.

Release builds fail closed without Firebase and upload signing, including when Gradle is invoked directly. Debug compilation without Firebase is only scaffold verification.

## Verified signed bundle

`/Volumes/CodexDev/Projects/AT-CAPACITY-Releases/android/AT-CAPACITY-1.0.0-1.aab` was built from source revision `c9f3215e7d5c82a0adb99e51612d37e7902cd635` on 6 October 2026. Version `1.0.0`, code `1`; SHA256 `255fd8226d75627c999be7c967e3aa9cfcdf513078b10713cc8b10800eb27ed7`. `jarsigner` verifies the bundle, and its certificate matches the saved public upload certificate. Bundle resources contain the correct Firebase project/app IDs and do not contain the private server credential. Android lint with the real Firebase configuration passes with zero errors and 24 warnings. The external `build-receipt.json` records this binary's source revision and untested/unsubmitted status.

The bundle has not been installed on a phone or uploaded to Play. Complete the gates below before treating it as submission-ready. Preserve and securely back up the existing upload key; do not regenerate it.

## Links and platform behaviour

Android HTTPS intent filters cover login, onboarding callback/confirmation and portal URLs. `atcapacity://` uses the existing bounded route resolver. Support reporting stays inside the WebView; AI replies include a reporting action that carries only the selected response in a short-lived, tab-local draft, never in a URL or analytics payload.

After Play App Signing is enabled, obtain **the app-signing certificate SHA256** from Play Console. Configure `ANDROID_APP_LINKS_SHA256_FINGERPRINTS` (comma separated if multiple certificates) and deploy `/.well-known/assetlinks.json`. The upload certificate alone does not verify Play-installed apps. Validate Android's domain verification and actual emailed recovery links before release.

Android initially uses the existing grouped web workout; it does not claim the Swift runner is ported. Test supersets, AMRAP/EMOM timers, logging, interruption/restore and exercise video opening on Android. Hardware back navigates within the app and minimises at the portal/login root. Offline cold launch uses the bundled reconnection page; full offline workouts are not promised.

## Draft Play listing

Title: **AT CAPACITY**

Short description: **Your coaching, training, progress and AI support in one place.**

Full description:

AT CAPACITY brings Gordy Elliott's coaching into one app for his existing clients.

Access your personalised training plan, follow exercise instructions and available demonstration videos, and record your sessions. Keep nutrition targets, daily tracking, progress and coaching messages together. AT CAPACITY AI provides additional support with your plan and next steps, alongside Gordy's coaching. Optional supported wearable and calendar connections help bring relevant activity, recovery and schedule information into your coaching experience.

An existing coaching account is required. Available features depend on your programme. This is a fitness and coaching service, not a medical or emergency service.

Store URLs after deploying this branch: privacy `https://app.onlinegordy.com/privacy`; support `https://app.onlinegordy.com/support`; account deletion `https://app.onlinegordy.com/account-deletion`.

Do not copy the Apple privacy questionnaire blindly. Prepare Play Data Safety from the current inventory, including account/contact information, coaching/health records, messages, optional attachments/photos, calendar data, wearable data and device notification identifiers. Match collection/sharing purposes, encryption, deletion and provider statements to the deployed Android build. Complete Health apps, content rating, target audience, ads and app-access declarations; supply the verified dedicated fictional reviewer account privately.

Useful requirements: [target API](https://support.google.com/googleplay/android-developer/answer/11926878), [health declaration](https://support.google.com/googleplay/android-developer/answer/14738291), [AI reporting](https://support.google.com/googleplay/android-developer/answer/13985936), [deletion](https://support.google.com/googleplay/android-developer/answer/13327111).

## Submission gates

- Gordy completes owner-only identity/phone/website verification so Create app unlocks.
- SDK licence and external build tools installed; debug APK and Android lint pass (verified 6 October 2026: API36/min24, package/version inspected, debug signature verified, 13 focused Android/push tests pass). Android lint has 24 non-blocking tooling/asset/backup warnings. Voice-note microphone permissions are declared; runtime recording still requires installed-device verification.
- Firebase client/server project and production migration configured (verified); verify the backend deployment before device testing.
- Signed AAB and upload certificate inspected (verified); associate the future Play app-signing certificate with the production domain.
- Installed Android walkthrough: login/setup, training groups/timers/video, nutrition, AI/reporting, coach messages/upload, optional integration authorisation, keyboard/back, offline page, notification lifecycle and deletion instructions.
- Physical Android phone smoke test; emulator alone does not prove real-device push/background behaviour.
- Real Android screenshots/feature graphic prepared; truthful forms and working reviewer login checked.
- Upload to Play internal testing, examine automated/pre-launch findings, then submit after owner verification and release checks are satisfied.
