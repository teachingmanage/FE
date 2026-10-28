// Captures screenshots of the app at several viewport sizes.
//
// Usage: node scripts/screenshot.js <url> <outDir> [width:height ...]
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const URL_UNDER_TEST = process.argv[2] || "http://localhost:3000";
const OUT_DIR = process.argv[3] || path.join(process.cwd(), "screenshots");
const SIZES = (process.argv.slice(4).length ? process.argv.slice(4) : ["1280x900", "390x844"])
  .map((s) => s.split("x").map(Number))
  .map(([width, height]) => ({ width, height }));

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9345;

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "shot-"));
fs.mkdirSync(OUT_DIR, { recursive: true });

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

async function waitFor(fn, timeoutMs = 15000) {
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
      "--hide-scrollbars",
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

    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: SIZES[0].width,
      height: SIZES[0].height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    for (const size of SIZES) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 1,
        mobile: size.width < 700,
      });
      await send("Page.navigate", { url: URL_UNDER_TEST });
      await new Promise((r) => setTimeout(r, 3500));

      const { data } = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      const file = path.join(OUT_DIR, `shot-${size.width}x${size.height}.png`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      console.log("wrote", file);
    }

    ws.close();
  } finally {
    chrome.kill();
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

main().catch((e) => {
  console.error("screenshot failed:", e);
  process.exit(1);
});
