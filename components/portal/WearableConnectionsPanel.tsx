"use client";

import { connectionFailureMessage } from "@/lib/terra/connection-copy";
import Image from "next/image";
import Link from "next/link";
import CyclingStatusText from "@/components/ui/CyclingStatusText";
import type { WearableConnection } from "@/lib/wearable-insights";

export type WearableProvider = {
  id: string;
  name: string;
  description: string;
  logoSrc?: string;
  logoClass?: string;
  wordmark?: string;
  tileClass: string;
  disabled?: boolean;
  unavailableNote?: string;
};

export const wearableProviders: WearableProvider[] = [
 { id:"apple", name:"Apple Health", description:"Activity, sleep and heart-rate trends from your iPhone.",logoSrc:"/images/providers/apple-health.svg",tileClass:"bg-white" },
 { id:"healthconnect", name:"Health Connect", description:"Activity, sleep and heart-rate trends from your Android phone.",logoSrc:"/images/providers/health-connect.svg",tileClass:"bg-white" },
  {
    id: "garmin",
    name: "Garmin",
    description: "Training load, workouts, steps, heart rate and sleep.",
    logoSrc: "/images/providers/garmin.svg",
    logoClass: "h-auto w-8",
    tileClass: "bg-[#0b2232]",
  },
  {
    id: "oura",
    name: "Oura",
    description: "Sleep, recovery, HRV and resting heart rate.",
    logoSrc: "/images/providers/oura.svg",
    logoClass: "h-auto w-9",
    tileClass: "bg-[#26242a]",
  },
  {
    id: "myfitnesspal",
    name: "MyFitnessPal",
    description: "Calories, protein, carbohydrates, fats and hydration.",
    logoSrc: "/images/providers/myfitnesspal.svg",
    logoClass: "h-7 w-7",
    tileClass: "bg-[#0066ee]",
  },
  {
    id: "fitbit",
    name: "Fitbit",
    description: "Daily activity, sleep and heart-rate data.",
    logoSrc: "/images/providers/fitbit.svg",
    logoClass: "h-7 w-7",
    tileClass: "bg-[#0e2b2d]",
  },
  {
    id: "whoop",
    name: "WHOOP",
    description: "Recovery, sleep, strain and workouts.",
    wordmark: "WHOOP",
    tileClass: "bg-[#f5f5f5] text-black",
    disabled: true,
  },
  {
    id: "strava",
    name: "Strava",
    description: "Runs, rides and training activity.",
    logoSrc: "/images/providers/strava.svg",
    logoClass: "h-6 w-6",
    tileClass: "bg-[#fc4c02]",
    disabled: true,
  },
];

export default function WearableConnectionsPanel({
  connections,
  consentAccepted,
  available,
  mockMode,
  nativeHealth = null,
  garminAvailable = false,
  whoopAvailable,
  connecting,
  disconnecting,
  onConsentChange,
  onConnect,
  onDisconnect,
  onBack,
}: {
  connections: WearableConnection[];
  consentAccepted: boolean;
  available: boolean;
  mockMode: boolean;
  nativeHealth?: "apple" | "healthconnect" | null;
  garminAvailable?: boolean;
  whoopAvailable: boolean;
  connecting: string | null;
  disconnecting: string | null;
  onConsentChange: (accepted: boolean) => void;
  onConnect: (provider: string) => void;
  onDisconnect: (connection: WearableConnection) => void;
  onBack: () => void;
}) {
  const connectionByProvider = new Map<string, WearableConnection>();
  for (const connection of connections) connectionByProvider.set(connection.provider, connection);
  const providers = wearableProviders.filter(provider => !nativeHealth || !["apple","healthconnect"].includes(provider.id) || provider.id === nativeHealth || connectionByProvider.has(provider.id)).map((provider) => (
    ["apple","healthconnect"].includes(provider.id) && nativeHealth !== provider.id ? {...provider, unavailableNote:"Open the AT CAPACITY app on your phone to connect"} :
    provider.id === "garmin" && !garminAvailable ? { ...provider, unavailableNote: "Garmin has paused new third-party connections. Garmin users can sync through Apple Health once it is available." } : provider.id === "whoop" ? { ...provider, disabled: !whoopAvailable } : provider
  ));
  const activeProviders = providers.filter((provider) => !provider.disabled);
  const connectedConnections = connections.filter((connection) => connection.status === "connected");
  const connectedProviderDetails = connectedConnections
    .map((connection) => providers.find((provider) => provider.id === connection.provider))
    .filter((provider): provider is WearableProvider => Boolean(provider));
  const mostRecentSync = connectedConnections
    .map((connection) => connection.last_data_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0];

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl pb-28 sm:pb-8">
      <header className="flex items-start gap-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Health and Capacity"
          className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/[0.09] bg-white/[0.035] text-white/65 transition hover:bg-white/[0.07]"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ef68db]">Health data</div>
          <h1 className="mt-1 font-heading text-[2.1rem] font-bold leading-none tracking-[-0.02em] text-white sm:text-[2.6rem]">Connections</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/52">
            Choose the services that can contribute to your recovery, activity and nutrition picture.
          </p>
        </div>
      </header>

      <div className="mt-7 flex items-center justify-between gap-4 border-y border-white/[0.07] py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${connectedConnections.length ? "border-[#58d6b0]/25 bg-[#58d6b0]/[0.08] text-[#58d6b0]" : "border-white/10 bg-white/[0.035] text-white/35"}`}>
            <span className={`h-2 w-2 rounded-full ${connectedConnections.length ? "bg-[#58d6b0] shadow-[0_0_12px_rgba(88,214,176,0.75)]" : "bg-white/25"}`} />
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.17em] text-white/32">Data flow</div>
            <div className="mt-0.5 truncate text-sm font-semibold text-white/82">
              {connectedConnections.length ? `${connectedConnections.length} service${connectedConnections.length === 1 ? "" : "s"} connected` : "No services connected"}
            </div>
            {mostRecentSync && <div className="mt-0.5 text-[10px] text-white/30">Latest signal {formatDate(mostRecentSync)}</div>}
          </div>
        </div>
        {connectedProviderDetails.length > 0 && (
          <div className="flex shrink-0 -space-x-2" aria-label={`${connectedProviderDetails.length} connected health services`}>
            {connectedProviderDetails.map((provider) => (
              <ProviderMark key={provider.id} provider={provider} compact />
            ))}
          </div>
        )}
      </div>

      {mockMode && (
        <div className="mt-6 rounded-[20px] border border-amber-400/15 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-200/85">
          Preview mode is active. Connections created here use demonstration data.
        </div>
      )}
      {!available && (
        <div className="mt-6 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/55">
          New health app connections are temporarily unavailable.
        </div>
      )}

      <section aria-labelledby="health-consent-heading" className="mt-6 overflow-hidden rounded-[26px] border border-[#e440d0]/20 bg-[#e440d0]/[0.055]">
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e440d0]/12 text-[#ef68db]">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="health-consent-heading" className="text-lg font-semibold tracking-tight text-white">Your permission comes first</h2>
              <p className="mt-1 text-sm leading-6 text-white/52">
                Terra securely passes the health categories you approve to AT CAPACITY. Gordy uses them for coaching context;
                they never change your programme automatically.
              </p>
            </div>
          </div>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[18px] border border-white/[0.08] bg-black/15 p-4">
            <input
              type="checkbox"
              checked={consentAccepted}
              onChange={(event) => onConsentChange(event.target.checked)}
              aria-describedby="health-consent-status"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#e440d0] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ef68db]"
            />
            <span className="min-w-0 flex-1 text-sm font-medium leading-6 text-white/76">
              I consent to AT CAPACITY receiving health data from the service I choose. I have read the{" "}
              <Link href="/privacy" className="text-[#ef68db] underline underline-offset-2">Privacy Notice</Link>
              {" "}and{" "}
              <a
                href="https://tryterra.co/end-user-privacy"
                target="_blank"
                rel="noreferrer"
                className="text-[#ef68db] underline underline-offset-2"
              >
                Terra Privacy Policy
              </a>.
            </span>
          </label>
          <p id="health-consent-status" role="status" className="mt-3 text-sm leading-6 text-white/60">
            {consentAccepted ? "Permission confirmed. Choose Connect for the service you want to add." : "Tick the checkbox to enable Connect."}
          </p>
        </div>
      </section>

      <section className="mt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">Available now</div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">Your health services</h2>
          </div>
          <div className="hidden text-xs text-white/35 sm:block">
            {connectedConnections.length} connected
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#151419]">
          {activeProviders.map((provider, index) => {
            const connection = connectionByProvider.get(provider.id);
            return (
              <ProviderRow
                key={provider.id}
                provider={provider}
                connection={connection}
                consentAccepted={consentAccepted}
                available={available}
                connecting={connecting}
                disconnecting={disconnecting}
                divider={index > 0}
                onConnect={onConnect}
                onDisconnect={onDisconnect}
              />
            );
          })}
        </div>
      </section>

      <p className="mt-8 text-center text-xs leading-5 text-white/30">
        Disconnecting stops new information being received. Existing coaching summaries remain under the retention terms in the Privacy Notice.
      </p>
    </div>
  );
}

function ProviderRow({
  provider,
  connection,
  consentAccepted,
  available,
  connecting,
  disconnecting,
  divider,
  onConnect,
  onDisconnect,
}: {
  provider: WearableProvider;
  connection?: WearableConnection;
  consentAccepted: boolean;
  available: boolean;
  connecting: string | null;
  disconnecting: string | null;
  divider: boolean;
  onConnect: (provider: string) => void;
  onDisconnect: (connection: WearableConnection) => void;
}) {
  const connected = connection?.status === "connected";
  const pending = connection?.status === "pending";
  const errored = connection?.status === "error";
  return (
    <article className={`flex flex-col gap-4 p-4 transition hover:bg-white/[0.018] sm:flex-row sm:items-center sm:p-5 ${divider ? "border-t border-white/[0.065]" : ""}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <ProviderMark provider={provider} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-white">{provider.name}</h3>
            {provider.unavailableNote && provider.id === "garmin" ? <span className="text-xs text-amber-200">Paused by Garmin</span> : <ConnectionState status={connection?.status} />}
          </div>
          <p className="mt-1 text-xs leading-5 text-white/43 sm:text-sm">{provider.description}</p>
          {connection && (
            <p className="mt-1.5 text-[11px] text-white/28">
              {provider.unavailableNote ? provider.id === "garmin" ? "Paused by Garmin" : provider.unavailableNote : connection.failure_reason && connection.failure_reason !== "orphan_reference" ? connectionFailureMessage(connection.failure_reason, provider.id) : connected ? connection.last_data_at ? `Last received ${formatDate(connection.last_data_at)}` : "Connected. Waiting for the first readings." : errored ? "Connection wasn't completed. Reconnect to try again." : pending ? "Awaiting authorisation and verification. You can retry if you closed the provider window." : "Not connected"}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end">
        {provider.unavailableNote && !connected ? <p className="max-w-xs text-xs leading-5 text-white/50">{provider.unavailableNote}</p> : connected ? (
          <button
            type="button"
            onClick={() => onDisconnect(connection)}
            disabled={disconnecting === connection.id}
            className="min-h-10 rounded-full border border-white/10 px-4 text-xs font-semibold text-white/48 transition hover:border-red-400/30 hover:text-red-300 disabled:opacity-45"
          >
            <CyclingStatusText
              active={disconnecting === connection.id}
              idle="Disconnect"
              messages={["Disconnecting…", "Updating…", "Nearly there…"]}
            />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onConnect(provider.id)}
            disabled={!consentAccepted || !available || connecting !== null}
            className="min-h-10 min-w-[100px] rounded-full bg-[#f7f4f7] px-4 text-xs font-bold text-[#171419] transition hover:bg-[#ffffff] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/25"
          >
            <CyclingStatusText
              active={connecting === provider.id}
              idle={errored || pending ? "Reconnect" : "Connect"}
              messages={["Starting…", "Creating session…", "Opening Terra…", "Nearly there…"]}
            />
          </button>
        )}
      </div>
    </article>
  );
}

function ProviderMark({ provider, compact = false }: { provider: WearableProvider; compact?: boolean }) {
  return (
    <div
      title={provider.name}
      className={`flex shrink-0 items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${compact ? "h-10 w-10 rounded-full border-2 border-[#0a090c]" : "h-12 w-12 rounded-[16px]"} ${provider.tileClass}`}
    >
      {provider.logoSrc ? (
        <Image
          src={provider.logoSrc}
          alt=""
          aria-hidden="true"
          width={48}
          height={48}
          loading="eager"
          unoptimized
          className={`object-contain ${provider.logoClass || "h-7 w-7"}`}
        />
      ) : (
        <span className="text-[9px] font-black tracking-[-0.04em]">{provider.wordmark}</span>
      )}
    </div>
  );
}

function ConnectionState({ status }: { status?: WearableConnection["status"] }) {
  const appearance = status === "connected"
    ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300"
    : status === "pending"
      ? "border-amber-300/20 bg-amber-300/[0.08] text-amber-200"
      : status === "error"
        ? "border-red-400/20 bg-red-400/[0.08] text-red-300"
        : "border-white/10 bg-white/[0.025] text-white/30";
  const label = status === "connected" ? "Connected" : status === "pending" ? "Pending" : status === "error" ? "Attention" : "Not connected";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${appearance}`}>
      {label}
    </span>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
