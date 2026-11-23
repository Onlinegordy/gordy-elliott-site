import type { Viewport } from "next";
import Sidebar from "@/components/portal/Sidebar";
import MobileNav from "@/components/portal/MobileNav";
import IOSUpdatePrompt from "@/components/portal/IOSUpdatePrompt";
import PushNotificationBanner from "@/components/portal/PushNotificationBanner";
import { ToastProvider } from "@/components/ui/Toast";
import PortalKeyboardState from "@/components/portal/PortalKeyboardState";

export const metadata = {
  title: "AT CAPACITY - Client Portal",
};

// Portal is always dark, regardless of system preference — match status-bar colour
// to the bg-bg-primary token so PWA standalone status bar doesn't flash white.
export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <PortalKeyboardState />
      <div className="portal-shell dark min-h-screen bg-bg-primary text-text-primary">
        <Sidebar />
        <main className="portal-main min-h-screen pb-[calc(8.5rem+env(safe-area-inset-bottom,0px))] sm:pb-32 lg:ml-[260px] lg:!w-[calc(100%_-_260px)] lg:!max-w-[calc(100vw_-_260px)] lg:pb-0">
          <div className="portal-page-frame mx-auto px-0 pb-5 sm:px-6 sm:py-8">
            <IOSUpdatePrompt />
            <PushNotificationBanner />
            {children}
          </div>
        </main>
        <MobileNav />
      </div>
    </ToastProvider>
  );
}
