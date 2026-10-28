import http from "node:http";
import https from "node:https";

// Resolves the .NET backend that the Next.js proxy forwards to.
//
// The upstream can be configured in three ways, in order of precedence:
//
//   1. `TEACHING_API_URL` — a full URL, e.g. the Azure App Service address.
//   2. `TEACHING_API_HOST` + `TEACHING_API_PORT` — host and port separately.
//   3. The built-in default: `localhost:7023` (the local dev backend).
//
// The resolution happens on the server, so the backend address is never
// exposed to the browser and no CORS preflight is required.

export type ProxyResult = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Buffer;
};

type Upstream = {
  protocol: "http:" | "https:";
  hostname: string;
  port: string;
  // The value sent in the `Host` header. It must match the backend we are
  // actually talking to, otherwise virtual hosts (like Azure App Service)
  // route the request to the wrong site.
  host: string;
  // Whether TLS verification may be skipped. Only ever true for a local
  // backend using a self-signed development certificate — never for a
  // public HTTPS endpoint.
  insecureTLS: boolean;
  // A path prefix, when the backend is mounted under a sub-path.
  basePath: string;
  // A human readable description, used in error messages.
  label: string;
};

function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    h.endsWith(".localhost")
  );
}

// The public backend address, for display in the UI.
export function upstreamLabel(): string {
  return resolveUpstream().label;
}

export function resolveUpstream(): Upstream {
  const explicit = process.env.TEACHING_API_URL?.trim();

  if (explicit) {
    let url: URL;
    try {
      url = new URL(explicit);
    } catch {
      throw new Error(
        `TEACHING_API_URL is not a valid URL: "${explicit}". Expected something like "https://my-api.azurewebsites.net".`
      );
    }

    const isHttps = url.protocol === "https:";
    const port = url.port || (isHttps ? "443" : "80");
    const basePath = url.pathname.replace(/\/+$/, "");

    return {
      protocol: url.protocol as "http:" | "https:",
      hostname: url.hostname,
      port,
      // `url.host` already omits the default port for the scheme.
      host: url.host,
      // A public endpoint must be verified. Only a loopback address gets the
      // self-signed development certificate exemption.
      insecureTLS: isHttps && isLoopback(url.hostname),
      basePath,
      label: explicit,
    };
  }

  const hostname = process.env.TEACHING_API_HOST?.trim() || "localhost";
  const port = process.env.TEACHING_API_PORT?.trim() || "7023";

  return {
    protocol: "http:",
    hostname,
    port,
    host: `${hostname}:${port}`,
    insecureTLS: false,
    basePath: "",
    label: `http://${hostname}:${port}`,
  };
}

export function requestUpstream(
  upstream: Upstream,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer | undefined
): Promise<ProxyResult> {
  const isHttps = upstream.protocol === "https:";
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port,
        path: `${upstream.basePath}${path}`,
        method,
        headers,
        ...(upstream.insecureTLS ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue;
            out[k] = Array.isArray(v) ? v.join(", ") : String(v);
          }
          resolve({
            status: res.statusCode ?? 502,
            statusText: res.statusMessage ?? "",
            headers: out,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on("error", reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

// The upstream the proxy talks to.
//
// When `TEACHING_API_URL` is set the address is authoritative, so it is used
// as-is. Otherwise the local backend is probed over both protocols, because
// it may be started with the `http` or the `https` launch profile.
let resolvedUpstream: Upstream | null = null;
let probedProtocol: "http:" | "https:" | null = null;

export async function forwardUpstream(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer | undefined
): Promise<ProxyResult> {
  const explicit = process.env.TEACHING_API_URL?.trim();
  const upstream = resolveUpstream();

  if (explicit) {
    // A cold Azure App Service can drop the first connection while it
    // starts, so one retry is attempted before giving up.
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await requestUpstream(upstream, method, path, headers, body);
      } catch (e) {
        lastError = e;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
      }
    }
    throw lastError;
  }

  const order: ("http:" | "https:")[] = probedProtocol
    ? [
        probedProtocol,
        probedProtocol === "https:" ? "http:" : "https:",
      ]
    : ["https:", "http:"];

  let lastError: unknown;
  for (const protocol of order) {
    try {
      const res = await requestUpstream(
        { ...upstream, protocol },
        method,
        path,
        headers,
        body
      );
      probedProtocol = protocol;
      resolvedUpstream = { ...upstream, protocol };
      return res;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// The `Host` header to send, matching the backend we are actually talking to.
export function upstreamHostHeader(): string {
  return resolveUpstream().host;
}

// The upstream currently in use (after a successful request), for logging.
export function activeUpstream(): Upstream {
  return resolvedUpstream ?? resolveUpstream();
}
