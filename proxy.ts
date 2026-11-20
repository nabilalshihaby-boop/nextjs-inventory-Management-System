import { auth } from "@/auth";

// First layer of route protection (Next.js 16 Proxy, Node.js runtime).
// Public: "/" (sign in). /api/auth/*, Next static/image assets and the favicon never reach
// this function (see matcher). Everything else needs a valid session.
export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  if (req.auth || pathname === "/") return;
  return Response.redirect(new URL("/", req.nextUrl.origin));
});

export const config = {
  matcher: ["/((?!api/auth(?:/|$)|_next/static|_next/image|favicon\\.ico$).*)"],
};
