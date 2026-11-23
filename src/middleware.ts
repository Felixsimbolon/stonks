import { NextResponse, type NextRequest } from "next/server";

// A single-password gate for deployments. The app spends real money (Sectors
// credits, Claude tokens) on button presses and page views, so a public URL
// must not be usable by anyone who finds it. Set APP_PASSWORD to enable;
// without it (local dev) the gate is off.

export const AUTH_COOKIE = "stonks_auth";

/** The cookie holds a hash of the password, never the password itself. */
export async function passwordToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`stonks:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname === "/login") return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === (await passwordToken(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
