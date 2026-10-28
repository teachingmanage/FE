"use client";

import { useInstallPrompt } from "./use-install-prompt";

// The "install the app" button.
//
// It only appears when the browser says the app is installable, so it is
// never shown to users who cannot install (or who already have installed).
export function InstallButton({
  label,
  iosLabel,
  variant = "dark",
}: {
  label: string;
  iosLabel: string;
  // "dark" sits on the app's indigo header, "light" on the white login card.
  variant?: "dark" | "light";
}) {
  const { state, prompt } = useInstallPrompt();

  if (state === "hidden") return null;

  const className =
    variant === "dark"
      ? "rounded-xl bg-white/15 px-3 py-2 text-sm font-bold text-white shadow transition hover:bg-white/25 active:scale-[.97]"
      : "rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-700 transition hover:bg-indigo-100 active:scale-[.97]";

  if (state === "ios") {
    // iOS has no install event — the app is added through the share sheet.
    return (
      <button onClick={() => window.alert(iosLabel)} className={className}>
        ⬇️ {label}
      </button>
    );
  }

  return (
    <button onClick={() => void prompt()} className={className}>
      ⬇️ {label}
    </button>
  );
}
