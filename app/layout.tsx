import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegistrar } from "./lib/service-worker-registrar";
import "./globals.css";

// The `vietnamese` subset is required for Vietnamese diacritics (e.g. ệ, ộ, ữ).
// Without it the browser falls back to a different font for those glyphs.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

export const metadata: Metadata = {
  title: "Teaching Manager",
  description: "Manage classes, students and monthly tuition payments",
  // Links the generated /manifest.webmanifest, which is what makes the app
  // installable from the browser.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      // The .ico lives in app/, so Next.js serves it at /favicon.ico.
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Teaching",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches the indigo header gradient, used by the browser chrome and by
  // the installed app's splash screen.
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-100 text-zinc-900">
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
