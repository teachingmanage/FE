"use client";

import { useCallback, useSyncExternalStore } from "react";

// The "beforeinstallprompt" event is not in the DOM lib yet, so it is typed
// here. The browser only fires it when the app is installable, which is why
// the button stays hidden until the event arrives.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallState = "hidden" | "ios" | "ready";

const PROMPT_EVENT = "beforeinstallprompt";
const INSTALLED_EVENT = "appinstalled";

// The install state lives outside React so it can be read synchronously by
// useSyncExternalStore. This avoids an extra render pass and, more
// importantly, avoids setting state inside an effect.
let currentState: InstallState = "hidden";
let deferred: BeforeInstallPromptEvent | null = null;
let initialized = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(next: InstallState) {
  if (currentState === next) return;
  currentState = next;
  emit();
}

// The app is already installed when it runs in its own window.
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari reports the installed app this way.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as { MSStream?: unknown }).MSStream
  );
}

function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // Already installed: there is nothing to offer.
  if (isStandalone()) return;

  // iOS Safari has no install event — the app is added through the share
  // sheet, so the button explains the steps instead.
  if (isIOS()) setState("ios");
}

function subscribe(onStoreChange: () => void) {
  ensureInitialized();
  listeners.add(onStoreChange);

  const onPrompt = (e: Event) => {
    // Suppress the browser's own mini-infobar so the app can show its own
    // button in a consistent place.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    setState("ready");
  };

  const onInstalled = () => {
    deferred = null;
    setState("hidden");
  };

  window.addEventListener(PROMPT_EVENT, onPrompt);
  window.addEventListener(INSTALLED_EVENT, onInstalled);

  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener(PROMPT_EVENT, onPrompt);
    window.removeEventListener(INSTALLED_EVENT, onInstalled);
  };
}

function getSnapshot(): InstallState {
  ensureInitialized();
  return currentState;
}

// During hydration React must render what the server rendered, otherwise the
// server HTML (no button) and the client HTML (an iOS button) would differ.
function getServerSnapshot(): InstallState {
  return "hidden";
}

// Detects how the app can be installed and exposes a `prompt()` to start the
// install.
export function useInstallPrompt() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const prompt = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event can only be used once.
    deferred = null;
    if (outcome === "accepted") setState("hidden");
    return outcome === "accepted";
  }, []);

  return { state, prompt };
}
