import { NextRequest, NextResponse } from "next/server";
import http from "node:http";
import https from "node:https";
import {
  ACCESS_COOKIE,
  REMEMBER_COOKIE,
  cookieOptions,
} from "@/app/lib/session";

// The browser calls this same-origin route; the route forwards to the .NET
// backend. This keeps the frontend working no matter whether the backend is
// started with the `http` or the `https` launch profile — pointing the browser
// straight at a TLS-only port would fail with "Failed to fetch".
//
// The upstream URL is resolved on the server, so it is never exposed to the
// client and no CORS preflight is required.
//
// Authentication is cookie-based: the access token and the long-lived
// "remember me" token both live in httpOnly cookies, so the browser sends
// them back on every request and the user stays signed in across restarts.

const HOST = process.env.TEACHING_API_HOST || "localhost";
const PORT = process.env.TEACHING_API_PORT || "7023";

// Explicit override always wins.
const EXPLICIT =
  process.env.TEACHING_API_URL || process.env.NEXT_PUBLIC_API_URL || null;

type ProxyResult = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Buffer;
};

function requestOnce(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
  protocol: "http:" | "https:"
): Promise<ProxyResult> {
  const isHttps = protocol === "https:";
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol,
        hostname: HOST,
        port: PORT,
        path,
        method,
        headers,
        // The .NET dev certificate is self-signed. Node does not trust it by
        // default, so TLS verification is disabled for this local-only proxy.
        // Do not point this at a public HTTPS API.
        ...(isHttps ? { rejectUnauthorized: false } : {}),
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

// Which protocol the backend is actually speaking? Remembered after the first
// successful probe so later requests skip the extra attempt.
let resolvedProtocol: "http:" | "https:" | null = null;

async function forward(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer | undefined
): Promise<ProxyResult> {
  if (EXPLICIT) {
    const url = new URL(EXPLICIT);
    return requestOnce(method, path, headers, body, url.protocol as "http:" | "https:");
  }

  // The remembered protocol is only a hint: the backend may have been
  // restarted with the other launch profile, so fall back to trying both.
  const order: ("http:" | "https:")[] = resolvedProtocol
    ? [resolvedProtocol, resolvedProtocol === "https:" ? "http:" : "https:"]
    : ["https:", "http:"];

  let lastError: unknown;
  for (const protocol of order) {
    try {
      const res = await requestOnce(method, path, headers, body, protocol);
      resolvedProtocol = protocol;
      return res;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// Exchanges a "remember me" token for a fresh access token.
//
// Called when the access token is missing or expired but the remember cookie
// is still valid. Returns the new tokens, or null when there is no usable
// remember token.
async function refreshSession(
  rememberToken: string
): Promise<{
  token: string;
  rememberToken?: string;
  rememberExpiresDays?: number;
} | null> {
  try {
    const res = await forward(
      "POST",
      "/api/auth/refresh",
      {
        "content-type": "application/json",
        accept: "application/json",
        host: `${HOST}:${PORT}`,
      },
      Buffer.from(JSON.stringify({ rememberToken }))
    );

    if (res.status !== 200) return null;

    const data = JSON.parse(res.body.toString("utf8")) as {
      token?: string;
      rememberToken?: string;
      rememberExpiresDays?: number;
    };
    if (!data.token) return null;

    return {
      token: data.token,
      rememberToken: data.rememberToken,
      rememberExpiresDays: data.rememberExpiresDays,
    };
  } catch {
    return null;
  }
}

async function proxy(req: NextRequest) {
  // Strip the proxy prefix to get the real backend path.
  const path = req.nextUrl.pathname.replace(/^\/api\/api-proxy/, "") || "/";
  const search = req.nextUrl.search;

  const headers: Record<string, string> = {};
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  headers.host = `${HOST}:${PORT}`;
  headers["accept"] = req.headers.get("accept") ?? "application/json";

  const method = req.method;
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : Buffer.from(await req.arrayBuffer());

  // The access token normally comes from the httpOnly cookie. An explicit
  // Authorization header still wins, which keeps the API usable from tools
  // that do not have a cookie jar.
  let accessToken = req.cookies.get(ACCESS_COOKIE)?.value ?? null;
  const explicitAuth = req.headers.get("authorization");
  if (explicitAuth) {
    accessToken = explicitAuth.replace(/^Bearer\s+/i, "");
    headers.authorization = `Bearer ${accessToken}`;
  }

  // Only the endpoints that establish a session must work without one. The
  // "me" endpoint needs auth like any other protected route, so it is allowed
  // to trigger a refresh.
  const isAuthEndpoint =
    path === "/api/auth/login" ||
    path === "/api/auth/register" ||
    path === "/api/auth/refresh" ||
    path === "/api/auth/logout";
  let refreshed: {
    token: string;
    rememberToken?: string;
    rememberExpiresDays?: number;
  } | null = null;

  if (!explicitAuth && !isAuthEndpoint && !accessToken) {
    // No access token at all — try to restore the session from the remember
    // cookie.
    const remember = req.cookies.get(REMEMBER_COOKIE)?.value;
    if (remember) {
      refreshed = await refreshSession(remember);
      if (refreshed) accessToken = refreshed.token;
    }
  }

  if (accessToken && !explicitAuth) {
    headers.authorization = `Bearer ${accessToken}`;
  }

  try {
    const res = await forward(method, `${path}${search}`, headers, body);

    // The access token was rejected (expired or revoked). If the user asked to
    // be remembered, mint a new one instead of logging them out.
    if (res.status === 401 && !explicitAuth && !isAuthEndpoint) {
      const remember = req.cookies.get(REMEMBER_COOKIE)?.value;
      if (remember) {
        const retried = await refreshSession(remember);
        if (retried) {
          refreshed = retried;
          headers.authorization = `Bearer ${retried.token}`;
          const retry = await forward(method, `${path}${search}`, headers, body);
          return toResponse(req, retry, refreshed);
        }
      }
      // No usable remember token — drop the stale cookies.
      return toResponse(req, res, null, true);
    }

    // A successful login / register carries the tokens in the response body.
    // Move them into httpOnly cookies so the browser sends them back on every
    // request — that is what keeps the user signed in across reloads.
    if (res.status === 200 && (path === "/api/auth/login" || path === "/api/auth/register")) {
      const issued = extractIssuedTokens(res);
      if (issued) return toResponse(req, res, issued);
    }

    return toResponse(req, res, refreshed);
  } catch (e) {
    return Response.json(
      {
        title: "Cannot reach the API",
        detail: e instanceof Error ? `${e.message} (tried ${HOST}:${PORT})` : "Unknown error",
      },
      { status: 502 }
    );
  }
}

// Pulls the access token (and optional remember token) out of an auth
// response body.
function extractIssuedTokens(res: ProxyResult) {
  try {
    const data = JSON.parse(res.body.toString("utf8")) as {
      token?: string;
      rememberToken?: string | null;
      rememberExpiresDays?: number;
    };
    if (!data.token) return null;
    return {
      token: data.token,
      rememberToken: data.rememberToken ?? undefined,
      rememberExpiresDays: data.rememberExpiresDays ?? 0,
    };
  } catch {
    return null;
  }
}

function toResponse(
  req: NextRequest,
  res: ProxyResult,
  refreshed: {
    token: string;
    rememberToken?: string;
    rememberExpiresDays?: number;
  } | null,
  clearSession = false
) {
  const outHeaders = new Headers();
  const ct = res.headers["content-type"];
  if (ct) outHeaders.set("content-type", ct);

  // 204/205/304 must not carry a body, or the Response constructor throws.
  const nullBodyStatus = res.status === 204 || res.status === 205 || res.status === 304;

  const response = new NextResponse(nullBodyStatus ? null : new Uint8Array(res.body), {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders,
  });

  if (refreshed) {
    // Keep the cookies fresh so the session survives the next reload.
    response.cookies.set(
      ACCESS_COOKIE,
      refreshed.token,
      cookieOptions(req, 60 * 60 * 24 * 7)
    );
    if (refreshed.rememberToken) {
      const days =
        refreshed.rememberExpiresDays && refreshed.rememberExpiresDays > 0
          ? refreshed.rememberExpiresDays
          : 365;
      response.cookies.set(
        REMEMBER_COOKIE,
        refreshed.rememberToken,
        cookieOptions(req, 60 * 60 * 24 * days)
      );
    } else {
      // Logging in without "remember me" — drop any stale remember cookie so
      // the old long-lived session cannot be resurrected.
      response.cookies.delete(REMEMBER_COOKIE);
    }
  } else if (clearSession) {
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REMEMBER_COOKIE);
  }

  return response;
}

export async function GET(req: NextRequest) {
  return proxy(req);
}
export async function POST(req: NextRequest) {
  return proxy(req);
}
export async function PUT(req: NextRequest) {
  return proxy(req);
}
export async function PATCH(req: NextRequest) {
  return proxy(req);
}
export async function DELETE(req: NextRequest) {
  return proxy(req);
}
