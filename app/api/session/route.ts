import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, REMEMBER_COOKIE } from "@/app/lib/session";
import {
  forwardUpstream,
  upstreamHostHeader,
} from "@/app/lib/api-upstream";

// Session cookies for the Teaching app.
//
// The access token and the long-lived "remember me" token both live in
// httpOnly cookies. They are set by the API proxy when a login or register
// succeeds, and cleared here on logout.
//
// The cookies are httpOnly, so client-side JavaScript can never read them —
// an XSS bug cannot steal the session.

// Clears the session cookies and revokes the remember token (logout).
export async function DELETE(req: NextRequest) {
  const remember = req.cookies.get(REMEMBER_COOKIE)?.value;

  // Revoke the token server-side too, so a copied cookie cannot be reused
  // after the user has logged out.
  if (remember) {
    try {
      await forwardUpstream(
        "POST",
        "/api/auth/logout",
        {
          "content-type": "application/json",
          accept: "application/json",
          host: upstreamHostHeader(),
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
