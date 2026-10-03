// Sliding-window attempt limiter for login endpoints.
// Keys on the client-visible IP (XFF) but adds a GLOBAL cap and bounds the
// map — XFF is spoofable when the app is exposed directly, so per-key limits
// alone would be bypassable and the map itself leakable via unique spoofed IPs.

export interface RateLimiter {
  /** Record an attempt; returns true when the key (or the world) is over cap. */
  hit(key: string): boolean;
  /** Check without recording. */
  blocked(key: string): boolean;
}

export function makeRateLimiter(opts: { windowMs?: number; perKeyCap?: number; globalCap?: number; maxKeys?: number } = {}): RateLimiter {
  const windowMs = opts.windowMs ?? 60_000;
  const perKeyCap = opts.perKeyCap ?? 10;
  const globalCap = opts.globalCap ?? 60;
  const maxKeys = opts.maxKeys ?? 1000;
  const hits = new Map<string, number[]>();
  let global: number[] = [];

  const prune = (arr: number[], now: number) => arr.filter((t) => now - t < windowMs);

  function blocked(key: string): boolean {
    const now = Date.now();
    hits.set(key, prune(hits.get(key) ?? [], now)); // keeps the map pruned on access
    return (hits.get(key) as number[]).length >= perKeyCap || prune(global, now).length >= globalCap;
  }

  function hit(key: string): boolean {
    if (blocked(key)) return true;
    const now = Date.now();
    (hits.get(key) as number[]).push(now);
    global = prune(global, now);
    global.push(now);
    // Bound memory: drop the oldest keys when too many distinct IPs appear.
    if (hits.size > maxKeys) {
      const oldest = hits.keys().next().value as string;
      hits.delete(oldest);
    }
    return false;
  }

  return { hit, blocked };
}
