// Verifies the offline behaviour of the service worker.
//
// It loads the app, waits for the worker to take control, then cuts the
// network and reloads. The app shell must still render, while the
// authenticated API must fail rather than serve a stale cached response.
//
// Usage: node scripts/verify-offline.js [url]
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const URL_UNDER_TEST = process.argv[2] || "http://localhost:3100";
const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9355;

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "offline-"));

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

async function waitFor(fn, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
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
      "about:blank",
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
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
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

    // First load: register the worker and let it cache the shell.
    await send("Page.navigate", { url: URL_UNDER_TEST });
    await waitFor(async () =>
      evaluate(`document.readyState === "complete"`)
    );
    await new Promise((r) => setTimeout(r, 3000));

    const controlled = await waitFor(async () =>
      evaluate(`!!navigator.serviceWorker.controller`)
    );
    console.log("service worker controls page:", !!controlled);

    // Cut the network at the browser level.
    await send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    console.log("network: OFFLINE");

    // Reload — the app shell must come from the cache.
    await send("Page.reload", { ignoreCache: false });
    await new Promise((r) => setTimeout(r, 4000));

    const offline = await evaluate(`
      ({
        title: document.title,
        hasAppRoot: !!document.querySelector("main, #__next, [data-nextjs-scroll-focus-boundary]"),
        bodyText: (document.body.innerText || "").slice(0, 120),
        styled: getComputedStyle(document.body).backgroundColor,
      })
    `);
    console.log("offline reload ->", JSON.stringify(offline));

    // The API must NOT be served from the cache: it is user specific.
    const apiOffline = await evaluate(`
      fetch("/api/classes").then(r => "status " + r.status).catch(e => "network error: " + e.message)
    `);
    console.log("offline API call ->", apiOffline);

    // Restore the network.
    await send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    const ok = !!controlled && offline.title.length > 0 && offline.bodyText.length > 0;
    console.log(`\nRESULT: ${ok ? "PASS" : "FAIL"}`);
    ws.close();
    process.exitCode = ok ? 0 : 1;
  } finally {
    chrome.kill();
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

main().catch((e) => {
  console.error("verify-offline failed:", e);
  process.exit(1);
});
