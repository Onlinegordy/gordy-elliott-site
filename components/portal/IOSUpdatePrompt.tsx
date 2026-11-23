"use client";

import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { hasNewerIOSRelease } from "@/lib/native/ios-release";

const CHECK_INTERVAL = 15 * 60 * 1000;

export default function IOSUpdatePrompt() {
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "ios") return;
    let active = true;
    let lastCheck = 0;
    const controller = new AbortController();

    async function check() {
      if (document.hidden || Date.now() - lastCheck < CHECK_INTERVAL) return;
      lastCheck = Date.now();
      try {
        const [installed, response] = await Promise.all([
          App.getInfo(),
          fetch("/api/ios-release", { signal: controller.signal }),
        ]);
        if (!response.ok) return;
        const { version: latest } = await response.json();
        if (active) {
          setVersion(typeof latest === "string" && hasNewerIOSRelease(installed.version, latest) ? latest : null);
        }
      } catch {
        // Offline clients can keep using their current version.
      }
    }

    void check();
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      controller.abort();
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (!version || version === dismissed) return null;

  return (
    <section aria-label="App update" className="mb-4 rounded-2xl border border-white/10 bg-[#121212] p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-white">An app update is available</h2>
      <p className="mt-1 text-xs text-white/70">AT CAPACITY {version} is ready on the App Store.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a href="itms-apps://apps.apple.com/app/id6805066999" className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-semibold text-black">
          Update app
        </a>
        <button type="button" onClick={() => setDismissed(version)} className="min-h-11 px-3 text-sm text-white/80">
          Later
        </button>
      </div>
    </section>
  );
}
