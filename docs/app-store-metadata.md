# AT CAPACITY App Store Metadata

Maintained listing copy and review notes. Confirm feature claims against the selected binary and hosted portal before each submission; release version/build comes from `config/app-identity.json`.

## Product fields

| Field | Submission value |
| --- | --- |
| Name | AT CAPACITY by Gordy |
| Subtitle | Training, nutrition, coaching |
| Primary category | Health & Fitness |
| Secondary category | Lifestyle |
| Copyright | 2026 Gordy Elliott |
| Support URL | https://app.onlinegordy.com/support |
| Marketing URL | https://app.onlinegordy.com |
| Privacy Policy URL | https://app.onlinegordy.com/privacy |
| Privacy Choices URL | https://app.onlinegordy.com/privacy |
| Release | Manually release after approval |

`https://app.onlinegordy.com` is Gordy's canonical production domain. Use these URLs in App Store Connect and the Google OAuth verification submission.

## Promotional text

Your training plan, nutrition targets, daily tracking and direct coaching support from Gordy, together in one private client app.

## Description

AT CAPACITY is the private coaching companion for existing Gordy Elliott clients.

Your programme, progress and coach conversations stay together, so you always know what to focus on next.

TRAIN WITH A CLEAR PLAN

- Browse your current training programme and upcoming sessions
- Start a session, follow each prescribed exercise and record every set
- Review recent performance and keep your weekly schedule organised

KEEP NUTRITION PRACTICAL

- See your assigned nutrition plan and daily targets
- Track meals and review your recent consistency
- Keep everyday food decisions connected to your coaching goals

STAY CONNECTED TO YOUR COACH

- Send private text, photo and voice messages
- Complete weekly check-ins and receive feedback
- Log sleep, energy, stress, hydration and training in the Daily Tracker
- Keep consultations, documents and progress information in one place

COACHING CONTEXT THAT MOVES WITH YOU

Optional connected apps can contribute sleep, recovery, activity and nutrition summaries when enabled. Eligible clients can connect Google Calendar or Outlook Calendar with read-only access so AT CAPACITY can help reflect the shape of the week. These signals support coaching suggestions only and never diagnose a condition or change a programme automatically.

Eligible clients can also use AT CAPACITY AI to find assigned content and understand their existing coaching plan. AI does not replace Gordy, diagnose conditions or provide emergency or medical care.

AT CAPACITY is sign-in only. Coaching enrolment and payment happen outside the app, and an existing client account is required.

## Keywords

`fitness,coaching,training,workouts,nutrition,gym,progress,habits,recovery,wellness`

## Review contact

Maintain the release contact and fictional reviewer credentials in App Store Connect, outside source control.

## Review notes

AT CAPACITY is a sign-in-only companion app for existing Gordy Elliott coaching clients. Coaching enrolment and payment happen outside the app. There is no public account creation, subscription purchase or in-app purchase flow.

Use the supplied Demo Client account to inspect an assigned training programme and log a session; view the assigned nutrition plan; use Daily Tracker; review check-ins and coach replies; open DM; view consultation and Settings; and inspect Connected Apps. The account contains representative fictional data only.

Connected-health summaries are optional informational coaching signals. They do not diagnose conditions and never alter a training programme automatically. The Connected Apps screen shows the availability and current connection state reported by the server, allows a client to disconnect a connection, and does not substitute fabricated production data. Apple Health is not enabled in version 1.

Calendar connections for clients using the Founder Dashboard experience are optional and read-only. The app does not use EventKit or request the iOS calendar permission. Clients authorise Google Calendar or Outlook Calendar through the provider's own OAuth consent screen, processed by Composio as service provider. AT CAPACITY stores event identifiers, titles (private events shown as "Busy"), start/end times, busy status and a meeting link, but not descriptions or attendee lists. Disconnecting removes the synced event copies.

Notification permission is requested only after the client selects Enable. DMs, coach nudges, tasks and reminders use the same account-level pause/freeze suppression rules as in-app notifications.

Account deletion is available after sign-in under Settings > Delete account and requires explicit confirmation. The privacy policy and support page are also available publicly at the URLs supplied in App Store Connect.

Submission hold: do not copy these notes into App Store Connect or submit the app until the exact selected build, review credentials, external-provider presentation, account deletion and full reviewer journey have passed the final pre-submission checks. Remove any claim that is not verified on that exact build.

## Other submission answers

- Content rights: **Yes, the app has the necessary rights to all content it displays.** Confirm Gordy owns or is licensed to use every uploaded coaching video, document and image before final submission.
- Advertising identifier: **No.** The native authenticated app does not load Meta Pixel or use IDFA.
- In-app purchases: **No.** Existing clients enrol and pay outside the app.
- Export compliance: **No non-exempt encryption.** The app uses operating-system and standard HTTPS encryption and declares `ITSAppUsesNonExemptEncryption = NO`.
- Regulated medical device: **No.** The app provides fitness coaching and explicitly avoids diagnosis or treatment claims.
- Sign-in required: **Yes.** Supply the verified Demo Client credentials already held in App Store Connect.

## Apple Health release notes
For a binary that includes the optional Apple Health integration through TerraHealth, update the review notes to match the enabled feature. Read access is requested only after the user accepts the health-data notice and taps Connect; categories are activity, steps, calories, heart rate, resting heart rate, HRV and sleep. The SDK requires an update-purpose string but this integration does not write HealthKit data. Review requires a physical iPhone with populated Health data, permission denial/re-enable and background-delivery checks. Reinstall/new device creates a distinct Terra user mapped to the same client reference.
