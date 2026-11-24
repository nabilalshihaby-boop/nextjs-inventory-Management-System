import { auth } from "@/auth";
import { canOpenRoute } from "@/lib/access";

// First layer of route protection (Next.js 16 Proxy, Node.js runtime).
// Public: "/" (sign in). /api/auth/*, Next static/image assets and the favicon never reach
// this function (see matcher). Everything else needs a valid session.
export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  if (pathname === "/") return;
  if (!req.auth?.user) return Response.redirect(new URL("/", req.nextUrl.origin));
  // Second layer: the permission gate. A USER reaches only the routes its assigned (active) access role allows, plus its own
  // profile / preferences / password and the safe dashboard shell; everything else is denied by default. The same rule covers the
  // Server Actions of a page (they POST to the page's own path). OWNER always passes; ADMIN keeps its current access.
  // Every page and action re-checks its fine-grained permission itself (lib/roles.ts); this gate is defense in depth.
  if (!canOpenRoute(req.auth.user, pathname)) {
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Forbidden", { status: 403 });
    return Response.redirect(new URL("/dashboard", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/((?!api/auth(?:/|$)|_next/static|_next/image|favicon\\.ico$).*)"],
};
