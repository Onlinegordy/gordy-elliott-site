# AT CAPACITY Android build and release

Package and production host come from `config/app-identity.json`; Android version name/code come from `config/android-release.json`.

## Toolchain and storage

The build scripts require a full JDK 21, Android SDK platform 36 and an available external build root. Set `ANDROID_BUILD_ROOT` to that disk; the existing default is `/Volumes/CodexDev`. `scripts/android-environment.mjs` places SDK/tool caches below the build root. `JAVA_HOME` and `ANDROID_HOME` overrides must also resolve inside that root. Builds fail if it is unavailable.

Run `npm run android:tools -- --accept-license` only after accepting the SDK terms. The installer checks the downloaded command-line tools. Gradle uses bounded workers/memory and no persistent daemon.

## Build commands

- `npm run android:assets`: generate Android assets from the checked-in production icon.
- `npm run android:sync`: prepare the production shell and sync native assets/plugins.
- `npm run android:build`: build a debug APK.
- `npm run android:lint`: run Android lint.
- `npm run test:android`: run Android/push release contracts.
- `npm run android:bundle`: validate Firebase/signing and build the signed release AAB and installable release APK.

## Firebase and signing

Set `ANDROID_GOOGLE_SERVICES_FILE` to the private client configuration for the correct registered Android package. Sync copies it to ignored `android/app/google-services.json`. Configure server-side `FCM_SERVICE_ACCOUNT_JSON` separately in hosting; never bundle the server credential or commit it.

Supply the existing upload signing configuration using `ANDROID_SIGNING_CONFIG`, or provide `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` to the build. Back up the keystore securely. `npm run android:key` is only for initial key creation; do not regenerate an existing release identity. Release builds fail closed without Firebase and upload signing. Debug builds without Firebase do not establish push delivery.

## App links and release verification

After Play App Signing is configured, set `ANDROID_APP_LINKS_SHA256_FINGERPRINTS` to the app-signing certificate SHA256 value(s), not just the upload certificate. Deploy and verify `/.well-known/assetlinks.json`, then test recovery links on an installed build.

Before release, inspect the signed bundle identity/version and test login, training groups/timers/video, nutrition, AI/reporting, messages/uploads, integration returns, keyboard/back, offline reconnection, notification permission/delivery/tap/sign-out and account deletion. A simulator build alone does not verify real-device push or background behaviour.

Keep Play Console listing copy, declarations, reviewer access and release evidence outside the source repository. Verify them against the selected binary and hosted application before submission.
