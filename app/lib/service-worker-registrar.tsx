"use client";

import { useEffect } from "react";

// Registers the service worker that powers the PWA (offline shell + install
// metadata).
//
// Registration is deferred until after the page has loaded so it never
// competes with the app's own resources, and it is skipped in development
// where a stale cached shell would only cause confusion.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
