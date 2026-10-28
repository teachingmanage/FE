import { NextRequest, NextResponse } from "next/server";
import http from "node:http";
import https from "node:https";
import { ACCESS_COOKIE, REMEMBER_COOKIE } from "@/app/lib/session";

// Session cookies for the Teaching app.
//
// The access token and the long-lived "remember me" token both live in
// httpOnly cookies. They are set by the API proxy when a login or register
// succeeds, and cleared here on logout.
//
// The cookies are httpOnly, so client-side JavaScript can never read them —
// an XSS bug cannot steal the session.

const HOST = process.env.TEACHING_API_HOST || "localhost";
const PORT = process.env.TEACHING_API_PORT || "7023";

const EXPLICIT =
  process.env.TEACHING_API_URL || process.env.NEXT_PUBLIC_API_URL || null;

let resolvedProtocol: "http:" | "https:" | null = null;

function requestOnce(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
  protocol: "http:" | "https:"
): Promise<number> {
  const transport = protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol,
        hostname: HOST,
        port: PORT,
        path,
        method,
        headers,
        ...(protocol === "https:" ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 502));
      }
    );
    req.on("error", reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

async function forward(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: Buffer
): Promise<number> {
  if (EXPLICIT) {
    const url = new URL(EXPLICIT);
    return requestOnce(
      method,
      path,
      headers,
      body,
      url.protocol as "http:" | "https:"
    );
  }

  const order: ("http:" | "https:")[] = resolvedProtocol
    ? [resolvedProtocol, resolvedProtocol === "https:" ? "http:" : "https:"]
    : ["https:", "http:"];

  let lastError: unknown;
  for (const protocol of order) {
    try {
      const status = await requestOnce(method, path, headers, body, protocol);
      resolvedProtocol = protocol;
      return status;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// Clears the session cookies and revokes the remember token (logout).
export async function DELETE(req: NextRequest) {
  const remember = req.cookies.get(REMEMBER_COOKIE)?.value;

  // Revoke the token server-side too, so a copied cookie cannot be reused
  // after the user has logged out.
  if (remember) {
    try {
      await forward(
        "POST",
        "/api/auth/logout",
        {
          "content-type": "application/json",
          accept: "application/json",
          host: `${HOST}:${PORT}`,
        },
        Buffer.from(JSON.stringify({ rememberToken: remember }))
      );
    } catch {
      // The browser cookies are cleared regardless; a backend hiccup here must
      // not leave the user stuck in a signed-in state.
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REMEMBER_COOKIE);
  return res;
}
