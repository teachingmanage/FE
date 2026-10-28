import type { NextRequest } from "next/server";

// Shared constants for the session cookies.
//
// The access token and the long-lived "remember me" token are both httpOnly,
// so client-side JavaScript can never read them — an XSS bug cannot steal
// the session. The browser sends them back automatically on every request.

export const ACCESS_COOKIE = "teaching_session";
export const REMEMBER_COOKIE = "teaching_remember";

// Cookies are marked `secure` only when the request actually arrived over
// HTTPS, otherwise the browser would drop them on the plain-HTTP localhost
// setup this project uses in development.
export function isSecureRequest(req: NextRequest): boolean {
  const override = process.env.TEACHING_SECURE_COOKIES;
  if (override === "true") return true;
  if (override === "false") return false;

  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return req.nextUrl.protocol === "https:";
}

export function cookieOptions(req: NextRequest, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureRequest(req),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
