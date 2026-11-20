// Server-only. One-time grants that let exactly ONE session adopt a user's new sessionVersion.
//
// Why: after a self-service password change, sessionVersion is bumped so every old session dies,
// but the session that made the change should stay signed in. The jwt callback's
// `trigger: "update"` can also be reached by a browser POST to /api/auth/session with arbitrary
// data, so adopting the new version can't depend on anything a client could send. Instead the
// Server Action creates a random grant here (in server memory, never sent to the browser) and
// passes its id to updateSession() in the same request; the jwt callback consumes it once.
import { randomBytes } from "node:crypto";

type Grant = { userId: string; sessionVersion: number; expires: number };
const TTL_MS = 30_000;

// globalThis: one store per server process even if bundling duplicates this module.
const store: Map<string, Grant> = ((globalThis as { __bpSessionGrants?: Map<string, Grant> }).__bpSessionGrants ??= new Map());

export function createSessionGrant(userId: string, sessionVersion: number): string {
  const now = Date.now();
  for (const [k, g] of store) if (g.expires < now) store.delete(k);
  const id = randomBytes(32).toString("hex");
  store.set(id, { userId, sessionVersion, expires: now + TTL_MS });
  return id;
}

/**
 * Returns the granted version if `id` is a live grant for `userId`; the grant is used up either way.
 * `jti` identifies the exact cookie this request carried (Auth.js gives every issued JWT a fresh
 * random jti). It is remembered briefly — see bridgeAllows().
 */
export function consumeSessionGrant(id: unknown, userId: string, jti: unknown): number | null {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) return null;
  const g = store.get(id);
  store.delete(id);
  if (!g || g.userId !== userId || g.expires < Date.now()) return null;
  if (typeof jti === "string" && jti) bridges.set(jti, { userId, sessionVersion: g.sessionVersion, expires: Date.now() + BRIDGE_MS, uses: 0 });
  return g.sessionVersion;
}

// After a Server Action sets cookies, Next.js re-renders the page in the SAME response — and
// Auth.js reads the incoming request's cookie header there, i.e. the pre-change cookie. Without a
// bridge that re-render would see a stale sessionVersion and bounce the user. The bridge accepts
// only that one cookie (its exact jti), for a few seconds and a few reads; every other old session
// has a different jti and stays invalid. The browser already holds the re-issued cookie.
type Bridge = { userId: string; sessionVersion: number; expires: number; uses: number };
const BRIDGE_MS = 5_000;
const BRIDGE_MAX_USES = 10;
const bridges: Map<string, Bridge> = ((globalThis as { __bpSessionBridges?: Map<string, Bridge> }).__bpSessionBridges ??= new Map());

export function bridgeAllows(jti: unknown, userId: string, sessionVersion: number): boolean {
  if (typeof jti !== "string" || !jti) return false;
  const b = bridges.get(jti);
  if (!b) return false;
  if (b.expires < Date.now() || b.uses >= BRIDGE_MAX_USES) {
    bridges.delete(jti);
    return false;
  }
  if (b.userId !== userId || b.sessionVersion !== sessionVersion) return false;
  b.uses++;
  return true;
}
