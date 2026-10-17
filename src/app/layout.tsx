import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/app/providers";
import { PwaRegistration } from "@/components/itam/pwa-registration";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

const geistSans = localFont({
  src: [{ path: '../../public/fonts/Sarabun-Regular.ttf', weight: '400' }, { path: '../../public/fonts/Sarabun-Bold.ttf', weight: '700' }],
  variable: '--font-geist-sans',
  display: 'swap',
});
const geistMono = { variable: '' };

export const metadata: Metadata = {
  title: "Smart-Asset",
  description:
    "Smart-Asset — ระบบจัดการครุภัณฑ์ งานซ่อม PM และเอกสารราชการ",
  keywords: [
    "IT Asset Management",
    "ITAM",
    "Asset Tracking",
    "Next.js",
    "จัดการอุปกรณ์",
    "จดมิเตอร์",
  ],
  authors: [{ name: "POWER BY PNG TEAM" }],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Smart-Asset",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f97316",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  // Bug fix: when keyboard opens on mobile, resize the viewport (not overlay)
  // so forms + buttons stay visible above the keyboard.
  // interactive-widget=resizes-content makes the layout viewport shrink
  // when the keyboard appears — no JS needed.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        {/* PWA — iOS standalone + safe-area aware */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ITAM" />
        <meta name="format-detection" content="telephone=no" />
        {/* ── EARLY SW + CACHE CLEANUP (runs before React) ──────────────
            This script MUST run before any chunk loads. If a stale service
            worker (from a previous production visit) is intercepting
            requests, it will serve stale chunks that crash with
            "module factory is not available". We unregister + clear caches
            here, then force a clean reload if anything was found. */}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/* SPRINT-FIX: Removed next/script <Script> tag because React 19 /
            Next.js 16 rejects it with "Encountered a script tag while
            rendering React component" error that crashes the page.

            The SW cleanup logic has been moved to a client-side useEffect
            in pwa-registration.tsx (which already handles SW lifecycle).

            The chunk-load error auto-recovery is handled by the browser's
            native error event listener registered in Providers. */}
        <Providers>
          {children}
          <PwaRegistration />
        </Providers>
        <Toaster richColors position="top-right" />
        {/* Analytics/SpeedInsights render a <script> element that React 19
            flags in dev mode ("Encountered a script tag while rendering
            React component"). They no-op in dev anyway (debug mode, no
            requests sent), so only mount them in production to keep the
            dev console clean for QA. Known upstream issue:
            vercel/analytics#xxx with React 19. */}
        {process.env.NODE_ENV === "production" && (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        )}
      </body>
    </html>
  );
}
