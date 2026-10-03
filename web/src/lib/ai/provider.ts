// Minimal OpenAI-compatible chat client with an optional fallback provider.
// Successor to the legacy providers/ package (frontier/metis/deepseek collapsed
// into "any OpenAI-compatible endpoint configured via env").

import { env } from "@/lib/env";

export interface AiChatResult {
  content: string;
  model: string;
}

interface Endpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

function endpoints(): Endpoint[] {
  const c = env.ai();
  const list: Endpoint[] = [];
  if (c.baseUrl && c.apiKey && c.model) list.push({ ...c, label: "primary" });
  if (c.fallbackBaseUrl && c.fallbackApiKey && c.fallbackModel) {
    list.push({
      baseUrl: c.fallbackBaseUrl,
      apiKey: c.fallbackApiKey,
      model: c.fallbackModel,
      label: "fallback",
    });
  }
  return list;
}

async function callEndpoint(e: Endpoint, messages: { role: string; content: string }[]): Promise<AiChatResult> {
  const r = await fetch(`${e.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${e.apiKey}` },
    body: JSON.stringify({ model: e.model, messages, temperature: 0.4 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`ai ${e.label} http ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`ai ${e.label} empty response`);
  return { content, model: e.model };
}

export class AiError extends Error {}

export async function aiChat(messages: { role: string; content: string }[]): Promise<AiChatResult> {
  const eps = endpoints();
  if (!eps.length) throw new AiError("no AI endpoint configured (AI_BASE_URL/AI_API_KEY/AI_MODEL)");
  let lastError: unknown;
  for (const e of eps) {
    try {
      return await callEndpoint(e, messages);
    } catch (err) {
      lastError = err;
    }
  }
  throw new AiError(String(lastError));
}

export function aiConfigured(): boolean {
  return endpoints().length > 0;
}
