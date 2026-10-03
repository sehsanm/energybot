import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, aiChat, aiConfigured } from "@/lib/ai/provider";

function chatResponse(content: string | null): Response {
  return new Response(JSON.stringify({ choices: content === null ? [] : [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubAi() {
  vi.stubEnv("AI_BASE_URL", "https://primary.test/v1");
  vi.stubEnv("AI_API_KEY", "pk");
  vi.stubEnv("AI_MODEL", "primary-model");
  vi.stubEnv("AI_FALLBACK_BASE_URL", "https://fallback.test/v1");
  vi.stubEnv("AI_FALLBACK_API_KEY", "fk");
  vi.stubEnv("AI_FALLBACK_MODEL", "fallback-model");
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("aiChat", () => {
  it("is unconfigured without env", () => {
    vi.stubEnv("AI_BASE_URL", "");
    expect(aiConfigured()).toBe(false);
    expect(aiChat([{ role: "user", content: "x" }])).rejects.toThrow(AiError);
  });

  it("uses the primary endpoint", async () => {
    stubAi();
    const seen: { url: string; auth: string; model: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({
        url,
        auth: (init.headers as Record<string, string>).Authorization,
        model: JSON.parse(String(init.body)).model,
      });
      return chatResponse("سلام");
    });
    const r = await aiChat([{ role: "user", content: "سلام" }]);
    expect(r).toEqual({ content: "سلام", model: "primary-model" });
    expect(seen[0].url).toBe("https://primary.test/v1/chat/completions");
    expect(seen[0].auth).toBe("Bearer pk");
    expect(seen[0].model).toBe("primary-model");
  });

  it("falls back when the primary fails", async () => {
    stubAi();
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.startsWith("https://primary.test")) return new Response("boom", { status: 500 });
      return chatResponse("از بکاپ");
    });
    const r = await aiChat([{ role: "user", content: "x" }]);
    expect(r.content).toBe("از بکاپ");
    expect(r.model).toBe("fallback-model");
    expect(urls).toEqual(["https://primary.test/v1/chat/completions", "https://fallback.test/v1/chat/completions"]);
  });

  it("throws when every endpoint fails or answers empty", async () => {
    stubAi();
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    await expect(aiChat([{ role: "user", content: "x" }])).rejects.toThrow(AiError);

    vi.stubGlobal("fetch", async () => chatResponse(null));
    await expect(aiChat([{ role: "user", content: "x" }])).rejects.toThrow(AiError);
  });
});
