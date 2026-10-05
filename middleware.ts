import { NextRequest, NextResponse } from "next/server";

const LOCALES = ["nl", "en"];

// Send visitors without a language in the URL to /nl or /en:
// their saved choice first, then the browser language, Dutch by default.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) return;
  const saved = req.cookies.get("lang")?.value;
  const accept = (req.headers.get("accept-language") || "").toLowerCase();
  const locale = saved && LOCALES.includes(saved) ? saved : accept.startsWith("en") ? "en" : "nl";
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next|api|favicon|icon|.*\\..*).*)"] };
