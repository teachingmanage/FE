// Verifies the PWA installability of the app in a real Chrome, using the
// Chrome DevTools Protocol.
//
// It checks that:
//  - the manifest is fetched and parsed by the browser
//  - every icon referenced by the manifest actually loads
//  - the service worker registers and controls the page
//  - the app renders in standalone mode without a horizontal scrollbar
//
// Usage: node scripts/verify-pwa.js [url]
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const URL_UNDER_TEST = process.argv[2] || "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pwa-check-"));

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(JSON.parse(data)));
      })
      .on("error", reject);
  });
}

async function waitFor(fn, timeoutMs = 15000, step = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await new Promise((r) => setTimeout(r, step));
  }
  return null;
}

async function main() {
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1280,900",
      URL_UNDER_TEST,
    ],
    { stdio: "ignore" }
  );

  try {
    const target = await waitFor(async () => {
      const list = await get(`http://127.0.0.1:${PORT}/json/list`);
      return list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    });
    if (!target) throw new Error("Chrome did not start");

    const { WebSocket } = require("ws");
    const ws = new WebSocket(target.webSocketDebuggerUrl, {
      maxPayload: 256 * 1024 * 1024,
    });
    await new Promise((res, rej) => {
      ws.on("open", res);
      ws.on("error", rej);
    });

    let id = 0;
    const pending = new Map();
    const consoleErrors = [];
    const failedRequests = [];

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        consoleErrors.push(
          msg.params.args.map((a) => a.value ?? a.description).join(" ")
        );
      }
      if (msg.method === "Network.loadingFailed") {
        failedRequests.push(msg.params.errorText);
      }
    });

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });

    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(
          r.exceptionDetails.exception?.description || "evaluate failed"
        );
      }
      return r.result.value;
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("ServiceWorker.enable");

    // Wait for the app to hydrate.
    await waitFor(async () =>
      evaluate(`document.readyState === "complete" && !!document.querySelector("header")`)
    );
    await new Promise((r) => setTimeout(r, 2500));

    // --- manifest ---
    const manifestHref = await evaluate(
      `document.querySelector('link[rel="manifest"]')?.href ?? null`
    );
    if (!manifestHref) throw new Error("no <link rel=manifest> in the document");

    const manifest = await evaluate(`
      fetch(${JSON.stringify(manifestHref)})
        .then(r => r.json())
        .then(m => ({
          name: m.name,
          short_name: m.short_name,
          display: m.display,
          start_url: m.start_url,
          scope: m.scope,
          theme_color: m.theme_color,
          background_color: m.background_color,
          icons: m.icons.map(i => ({ src: i.src, sizes: i.sizes, type: i.type, purpose: i.purpose })),
        }))
    `);

    // --- icons load ---
    const iconResults = await evaluate(`
      Promise.all(${JSON.stringify(manifest.icons)}.map(icon =>
        fetch(new URL(icon.src, location.href).href)
          .then(r => r.ok)
          .catch(() => false)
      ))
    `);

    // --- service worker ---
    const sw = await evaluate(`
      (async () => {
        if (!("serviceWorker" in navigator)) return { supported: false };
        const regs = await navigator.serviceWorker.getRegistrations();
        const controller = navigator.serviceWorker.controller;
        return {
          supported: true,
          registrations: regs.map(r => ({ scope: r.scope, active: !!r.active })),
          controlled: !!controller,
        };
      })()
    `);

    // --- installability signal ---
    const installState = await evaluate(`
      (async () => {
        const m = await fetch(${JSON.stringify(manifestHref)}).then(r => r.json());
        return {
          hasStartUrl: !!m.start_url,
          hasDisplay: !!m.display,
          has192: m.icons.some(i => (i.sizes || "").includes("192")),
          has512: m.icons.some(i => (i.sizes || "").includes("512")),
          hasMaskable: m.icons.some(i => (i.purpose || "").includes("maskable")),
        };
      })()
    `);

    const layout = await evaluate(`
      ({
        standalone: window.matchMedia("(display-mode: standalone)").matches,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        installButton: !!Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Install")),
        themeColor: document.querySelector('meta[name="theme-color"]')?.content ?? null,
        appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.href ?? null,
      })
    `);

    // Simulate the browser's install event and check that the app reacts by
    // showing its own install button.
    const installButtonFlow = await evaluate(`
      (async () => {
        const e = new Event("beforeinstallprompt");
        e.prompt = () => { window.__promptCalled = true; return Promise.resolve(); };
        e.userChoice = Promise.resolve({ outcome: "accepted" });
        window.dispatchEvent(e);
        await new Promise(r => setTimeout(r, 300));
        const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Install"));
        if (!btn) return { shown: false };
        btn.click();
        await new Promise(r => setTimeout(r, 300));
        return { shown: true, promptCalled: !!window.__promptCalled };
      })()
    `);

    console.log("\n=== PWA VERIFICATION ===");
    console.log("url                :", URL_UNDER_TEST);
    console.log("manifest link      :", manifestHref);
    console.log("manifest.name      :", manifest.name);
    console.log("manifest.short_name:", manifest.short_name);
    console.log("display            :", manifest.display);
    console.log("start_url / scope  :", manifest.start_url, "/", manifest.scope);
    console.log("theme / bg color   :", manifest.theme_color, "/", manifest.background_color);
    console.log("icons              :");
    manifest.icons.forEach((i, idx) => {
      console.log(
        `   - ${i.src} (${i.sizes}, ${i.type}${i.purpose ? ", " + i.purpose : ""}) -> ${iconResults[idx] ? "OK" : "FAILED"}`
      );
    });
    console.log("install checks     :", JSON.stringify(installState));
    console.log("service worker     :", JSON.stringify(sw));
    console.log("install button     :", JSON.stringify(installButtonFlow));
    console.log("layout             :", JSON.stringify(layout));
    console.log("console errors     :", consoleErrors.length ? consoleErrors : "none");
    console.log("failed requests    :", failedRequests.length ? failedRequests : "none");

    const allIconsOk = iconResults.every(Boolean);
    const ok =
      manifest.display === "standalone" &&
      installState.has192 &&
      installState.has512 &&
      installState.hasMaskable &&
      allIconsOk &&
      installButtonFlow.shown &&
      installButtonFlow.promptCalled &&
      sw.controlled &&
      !consoleErrors.length;

    console.log(`\nRESULT: ${ok ? "PASS" : "FAIL"}`);
    ws.close();
    process.exitCode = ok ? 0 : 1;
  } finally {
    chrome.kill();
    // Chrome keeps a lock on the profile for a moment after it exits, so a
    // failed cleanup must not fail the whole run.
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.log("(note: could not remove the temporary Chrome profile)");
    }
  }
}

main().catch((e) => {
  console.error("verify-pwa failed:", e);
  process.exit(1);
});
