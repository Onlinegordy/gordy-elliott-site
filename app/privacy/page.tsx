import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How AT CAPACITY handles client information.",
};

const sections: Array<{
  title: string;
  body: string;
  id?: string;
  googlePolicyLink?: boolean;
  terraPolicyLink?: boolean;
  icoPolicyLink?: boolean;
}> = [
  {
    title: "Technical support reports",
    body: "When you report an app problem, AT CAPACITY stores the contact details, problem description, page path, device or app version and optional screenshot you submit, together with the submission time. Reports and screenshots are private to Gordy and authorised Flowstate support staff, who use them to investigate and resolve the problem. An email submitted without signing in is not treated as verified account ownership. Screenshots are stored privately and displayed through short-lived links. Please crop unrelated health or personal information from screenshots. Limited pseudonymous request information is used to prevent repeated or abusive submissions. You can ask for support records to be corrected or deleted through the support contact; necessary investigation records may be retained for as long as reasonably required to resolve and document the issue.",
  },
  {
    title: "Who is responsible and your legal rights",
    body: "RENDEZVOUS 1 LIMITED, operating AT CAPACITY through Gordon Elliott, is the data controller. Flowstate provides technical development, operation and support on its behalf. Core coaching information is processed to provide the coaching service you have agreed to; optional calendar, wearable, cycle and notification features are processed with your consent; and limited security and abuse-prevention records are processed for the legitimate interest of protecting the service. Where health information is involved, AT CAPACITY relies on the explicit consent collected in the app. You may ask to access, correct or erase your information, restrict or object to processing where applicable, withdraw consent for an optional feature, or request a portable copy. Withdrawing consent does not affect processing that was lawful before withdrawal. You may also complain to the UK Information Commissioner’s Office.",
    icoPolicyLink: true,
  },
  {
    title: "Information AT CAPACITY handles",
    body: "AT CAPACITY stores account and contact details, coaching plans, text messages and any private voice notes or photos you choose to send, check-ins, progress photos, training and nutrition logs, consultation answers, and any health, injury or cycle information you choose to provide. DM voice notes and photos are stored privately. If you are an active SHIFT client, messages and attachments you deliberately post in the SHIFT Community are visible to Gordy and other active SHIFT clients. The microphone, camera and photo library are used only when you choose to record or select something to send. If you connect a supported app through Terra, AT CAPACITY may also receive sleep, recovery, activity and nutrition summaries from that provider. If you connect Google Calendar or Outlook Calendar, AT CAPACITY reads the calendar and event information described below. For coached clients, AT CAPACITY also keeps coaching-administration records, such as call attendance, weekly notes of coaching support provided over WhatsApp, periodic review summaries, and an audited record of any correction to locked baseline figures.",
  },
  {
    title: "Google Calendar data AT CAPACITY accesses",
    body: "Connecting Google Calendar is optional. When you choose to connect it, AT CAPACITY requests read-only access to the list of calendars in the Google account you authorise and to events from those calendars for today and the following seven days. It accesses the calendar and event identifiers needed for syncing, event title, start and end times, all-day and busy status, cancellation status, and an available meeting link. AT CAPACITY does not store event descriptions, attendee lists or locations. Private or confidential event titles are stored as “Busy”. It cannot create, edit or delete Google Calendar events.",
  },
  {
    title: "How Google Calendar data is used",
    body: "AT CAPACITY uses the Google Calendar data described above to show your upcoming meetings and daily schedule, calculate calendar-density signals, and run its deterministic Capacity Checker and Storm Warning rules. These user-facing features help you and Gordy plan training and nutrition around busier weeks. Google Calendar data is not used for advertising, eligibility decisions, medical diagnosis or an unrelated purpose.",
  },
  {
    title: "Who receives Google Calendar data",
    body: "Composio processes Google authorisation, holds the Google connection credentials and makes the read-only Calendar API requests on AT CAPACITY’s behalf. Vercel processes the application requests, and the normalised fields listed above are stored in Supabase. You can see the data in your authenticated portal, and Gordy can see upcoming event details in his authenticated coaching view for the coaching purpose described above. Flowstate may access it only where necessary to operate, secure or support AT CAPACITY. Google Calendar data is not disclosed to Anthropic, OpenRouter, their downstream AI model providers, advertisers or data brokers, and it is not sold.",
  },
  {
    title: "Google Workspace data and AI",
    body: "AT CAPACITY uses Anthropic API and OpenRouter for separate AI-assisted features involving non-Google coaching information. Raw, aggregated and derived Google Calendar data is excluded from AI prompts, embeddings, knowledge bases and model-training datasets. Calendar-based Capacity Checker and Storm Warning outputs are produced by deterministic application rules, not an AI model. The use of raw or derived user data received from Google Workspace APIs will adhere to the Google User Data Policy, including the Limited Use requirements.",
    googlePolicyLink: true,
  },
  {
    title: "Google Calendar retention and deletion",
    body: "AT CAPACITY keeps the normalised calendar-event copies while the connection is active so it can provide the schedule and coaching features described above. Disconnecting Google Calendar stops future access, asks Composio to revoke the connected account and deletes the synced event copies held by AT CAPACITY. Deleting your AT CAPACITY account also deletes its associated calendar connection and event records.",
  },
  {
    title: "How information is used",
    body: "Your information is used to deliver and personalise coaching, show your plans and progress, support messaging and reminders, identify useful coaching trends, secure the service, and resolve technical problems. Connected-health data informs coaching suggestions only; it does not automatically change your programme and is not used for medical diagnosis or emergency care.",
  },
  {
    title: "SHIFT Community",
    body: "The SHIFT Community is available only to Gordy and active SHIFT clients. Posts, names and attachments in that space are shared with all current members of that group; it is not a private coaching channel. The app displays this warning before the conversation. Clients should use private DM for health information, personal coaching details or anything they do not want other SHIFT clients to see. Community media is stored privately and made available through short-lived links after membership is checked. Gordy can remove inappropriate posts.",
  },
  {
    title: "Connected health apps",
    body: "Connecting a supported health or nutrition app is optional. Before connecting, you must explicitly agree that the selected provider may share sleep, recovery, heart-rate, activity or nutrition data with AT CAPACITY through Terra. Gordy can use the resulting summaries for coaching. Terra manages the provider authorisation and delivers the data to AT CAPACITY; Vercel processes the application request and Supabase stores the connection, delivery record and coaching summary. Raw Terra delivery payloads are deleted after no more than 90 days. Disconnecting asks Terra to revoke and remove its connection, stops AT CAPACITY accepting new health data for it, and keeps existing coaching summaries until you delete your account or request their deletion.",
    terraPolicyLink: true,
  },
  {
    id: "garmin",
    title: "Garmin data and external AI",
    body: "AT CAPACITY excludes data received through a connected Garmin source, including historical Garmin records, from external AI requests, embeddings and coaching-knowledge ingestion. This also excludes app-generated summaries, recovery scores, inferences and other information derived from Garmin data. A machine-generated summary that mixes Garmin with other sources, or whose source cannot be verified, is withheld from AI rather than treated as independent non-Garmin data. Clearly verified non-Garmin sources may continue to support AI-assisted coaching. This restriction concerns app-collected source data and its automatic derivatives; it does not classify every statement a person chooses to type into a coaching conversation. Garmin records can still be shown to the client and authorised coach and used by deterministic application features. Historical data is not deleted by this exclusion. A direct, company-controlled Garmin integration is proposed but is not currently enabled or represented as approved. Under that proposed design Terra would not receive Garmin data or credentials. Vercel hosts and processes the application, Supabase provides authentication and storage, and authorised Flowstate technical staff support the service on the controller’s behalf. These infrastructure and support roles must be disclosed to Garmin; direct integration does not mean that no service providers are involved.",
  },
  {
    title: "AI-assisted features",
    body: "AT CAPACITY may send relevant coaching context excluding Google Calendar and connected Garmin source data and their derivatives to Anthropic API or OpenRouter to produce summaries or suggestions. OpenRouter routes those requests to the model identified for the feature. Google Calendar data and app-sourced Garmin data, including information derived from them, are technically excluded from these AI routes. Gordy remains responsible for coaching decisions. AI output can be incomplete or wrong and should not be treated as medical advice.",
  },
  {
    title: "Who receives information",
    body: "Information is available to Gordy and authorised service providers needed to operate AT CAPACITY, including Vercel for hosting and application processing, Supabase for authentication and database services, Resend for email, Apple Push Notification service, Google Firebase Cloud Messaging and web-push providers for notifications you enable, Terra for optional wearable connections, Composio for optional calendar connections, and the AI providers described above for permitted coaching information that excludes Google Calendar and app-sourced Garmin data and their derivatives. Information is not sold. Providers receive only the information needed to deliver their service.",
  },
  {
    title: "Retention and deletion",
    body: "Information is kept while your account is active and for as long as reasonably required for coaching, security, dispute resolution or legal obligations. You can permanently delete your account and associated coaching data from Settings in the client portal. Some records may be retained where the law requires it.",
  },
  {
    title: "Your choices",
    body: "You can update profile information, disconnect supported apps, turn optional cycle tracking off, and request access to or correction of your information. You can also delete your account in Settings. Disconnecting Google Calendar or Outlook Calendar stops new syncs and removes the synced calendar-event copies associated with that connection. Disconnecting a Terra health connection revokes Terra's access and stops AT CAPACITY accepting new data from it. Existing coaching summaries remain until you delete your account or request their deletion.",
  },
  {
    title: "Security and age",
    body: "AT CAPACITY uses access controls and encrypted connections to protect information, but no online service can promise absolute security. AT CAPACITY is intended for Gordy's coaching clients and is not directed to children under 16.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] px-5 py-10 text-white sm:px-8 sm:py-16">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-[#f06be3] no-underline">AT CAPACITY</Link>
        <h1 className="mt-6 font-heading text-4xl font-bold">Privacy Policy</h1>
        <p className="mt-3 text-sm text-[#aeb0bb]">Effective 9 November 2026</p>
        <p className="mt-8 text-base leading-7 text-[#d3d4dc]">
          This policy explains how AT CAPACITY by Gordy Elliott handles information when you use the website, PWA or iOS app.
        </p>

        <div className="mt-10 space-y-9">
          {sections.map((section) => (
            <section key={section.title} id={section.id}>
              <h2 className="font-heading text-xl font-bold">{section.title}</h2>
              <p className="mt-3 text-[15px] leading-7 text-[#c3c4cd]">
                {section.body}
                {section.googlePolicyLink && (
                  <>
                    {" "}
                    <a
                      href="https://developers.google.com/terms/api-services-user-data-policy"
                      className="text-[#f06be3]"
                    >
                      Read the Google API Services User Data Policy.
                    </a>
                  </>
                )}
                {section.terraPolicyLink && (
                  <>
                    {" "}
                    <a
                      href="https://tryterra.co/end-user-privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#f06be3]"
                    >
                      Read the Terra End User Privacy Policy.
                    </a>
                  </>
                )}
                {section.icoPolicyLink && (
                  <>
                    {" "}
                    <a
                      href="https://ico.org.uk/make-a-complaint/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#f06be3]"
                    >
                      Make a complaint to the ICO.
                    </a>
                  </>
                )}
              </p>
            </section>
          ))}
          <section>
            <h2 className="font-heading text-xl font-bold">Contact</h2>
            <p className="mt-3 text-[15px] leading-7 text-[#c3c4cd]">
              Coaching clients can contact Gordy through private text, voice-note or photo DMs in AT CAPACITY. Privacy requests and account-access questions can also be sent through the <Link href="/support" className="text-[#f06be3]">support page</Link>; Flowstate will pass privacy requests to Gordy as data controller.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
