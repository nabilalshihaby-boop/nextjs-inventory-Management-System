// Server-only, best-effort brute-force limiter shared by POS unlock (password AND PIN) and the PIN
// settings form: at most 5 failed attempts per user within a fixed 60 second window; nothing reveals which
// credential was wrong. In memory (per server process), keyed by the authenticated user id.
const MAX_FAILS = 5;
const WINDOW_MS = 60_000;
const g = globalThis as unknown as { __unlockFails?: Map<string, { n: number; start: number }> };
const fails = (g.__unlockFails ??= new Map());

export function isLimited(userId: string, now = Date.now()): boolean {
  const f = fails.get(userId);
  return !!f && now - f.start < WINDOW_MS && f.n >= MAX_FAILS;
}
export function recordFailure(userId: string, now = Date.now()) {
  const f = fails.get(userId);
  if (!f || now - f.start >= WINDOW_MS) fails.set(userId, { n: 1, start: now });
  else f.n += 1;
}
export function clearFailures(userId: string) {
  fails.delete(userId);
}
export const LIMIT_MESSAGE = "Too many attempts. Wait a minute and try again.";
