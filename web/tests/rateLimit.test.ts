import { describe, expect, it } from "vitest";
import { makeRateLimiter } from "@/lib/auth/rateLimit";

describe("makeRateLimiter", () => {
  it("blocks a key after its per-key cap within the window", () => {
    const rl = makeRateLimiter({ windowMs: 60_000, perKeyCap: 3, globalCap: 100 });
    expect(rl.hit("a")).toBe(false);
    expect(rl.hit("a")).toBe(false);
    expect(rl.hit("a")).toBe(false);
    expect(rl.hit("a")).toBe(true); // 4th within window
    expect(rl.blocked("a")).toBe(true);
    expect(rl.blocked("b")).toBe(false); // other keys unaffected
  });

  it("enforces the global cap even across unique (spoofed) keys", () => {
    const rl = makeRateLimiter({ windowMs: 60_000, perKeyCap: 5, globalCap: 10 });
    let blocked = false;
    for (let i = 0; i < 10; i++) blocked = rl.hit(`spoof-${i}`);
    expect(blocked).toBe(false); // each key fresh…
    expect(rl.hit("spoof-11")).toBe(true); // …but the world is over cap
  });

  it("bounds memory under many distinct keys", () => {
    const rl = makeRateLimiter({ windowMs: 60_000, perKeyCap: 2, globalCap: 100_000, maxKeys: 5 });
    for (let i = 0; i < 20; i++) rl.hit(`k-${i}`);
    // Old keys were evicted; the newest key is still tracked.
    expect(rl.hit("k-19")).toBe(false);
    expect(rl.hit("k-19")).toBe(true); // 2nd hit of per-key cap 2
  });
});
