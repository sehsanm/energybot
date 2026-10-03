// Bot update dispatch shared by both channels (the "bot_core" of the rewrite,
// v1-simplified): commands, onboarding-lite (city + utility), bill capture,
// insights callback. All sends go through the channel-agnostic BotClient.

import { and, eq, isNull } from "drizzle-orm";
import { getDb, now, schema, type DB } from "@/lib/db";
import { env } from "@/lib/env";
import { copy } from "@/content/copy";
import { captureBill, priorBill } from "@/lib/billing/service";
import { generateSuggestions, renderSuggestions, targetsAsGoals } from "@/lib/billing/suggestions";
import { parseBillNumbers, InvalidBillNumbersError } from "@/lib/billing/billNumbers";
import { replaceGoalsForBill } from "@/lib/profile/goals";
import { guardUploadBytes, MAX_UPLOAD_BYTES } from "@/lib/billing/upload";
import type { BotClient } from "@/lib/channels/types";
import { resolveUser } from "./identity";

function logMessage(db: DB, userId: string, channel: string, role: "user" | "bot" | "admin", content: string, meta: Record<string, unknown> = {}): void {
  db.insert(schema.messages)
    .values({ userId, channel, role, content: content.slice(0, 4000), meta: JSON.stringify(meta), createdAt: now() })
    .run();
}

function getProfileRow(db: DB, userId: string) {
  return db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).get();
}

function updateProfileParts(
  db: DB,
  userId: string,
  parts: { household?: Record<string, unknown>; behaviour?: Record<string, unknown> },
): void {
  const row = getProfileRow(db, userId);
  const household = { ...JSON.parse(row?.household ?? "{}"), ...(parts.household ?? {}) };
  const behaviour = { ...JSON.parse(row?.behaviour ?? "{}"), ...(parts.behaviour ?? {}) };
  if (row) {
    db.update(schema.profiles)
      .set({ household: JSON.stringify(household), behaviour: JSON.stringify(behaviour), updatedAt: now() })
      .where(eq(schema.profiles.userId, userId))
      .run();
  } else {
    db.insert(schema.profiles)
      .values({
        userId,
        household: JSON.stringify(household),
        behaviour: JSON.stringify(behaviour),
        updatedAt: now(),
      })
      .run();
  }
}

async function sendUtilityPrompt(client: BotClient, chatId: string): Promise<void> {
  await client.sendMessage(chatId, copy.onboardingUtility, {
    keyboard: {
      inline: [
        [
          { text: "برق ⚡", callbackData: "onb:util:electricity" },
          { text: "گاز 🔥", callbackData: "onb:util:gas" },
        ],
        [{ text: "هر دو 🙌", callbackData: "onb:util:both" }],
      ],
    },
  });
}

function miniAppUrl(): string | null {
  const base = env.publicBaseUrl();
  // /home is the gated app entry; / is the public landing now.
  return base ? `${base.replace(/\/$/, "")}/home` : null;
}

function appKeyboard(): { inline: { text: string; webAppUrl: string }[][] } | undefined {
  const url = miniAppUrl();
  return url ? { inline: [[{ text: copy.openApp, webAppUrl: url }]] } : undefined;
}

// --- Onboarding-lite state -------------------------------------------------

function onbStep(db: DB, userId: string): string | null {
  const behaviour = JSON.parse(getProfileRow(db, userId)?.behaviour ?? "{}");
  return (behaviour as Record<string, unknown>).onb_step as string | null ?? null;
}

function setOnbStep(db: DB, userId: string, step: string | null): void {
  updateProfileParts(db, userId, { behaviour: { onb_step: step } });
}

// --- Insights ---------------------------------------------------------------

async function generateAndSendInsights(
  client: BotClient,
  chatId: string,
  userId: string,
  billRowId: string,
  db: DB = getDb(),
): Promise<boolean> {
  const bill = db.select().from(schema.bills).where(eq(schema.bills.id, billRowId)).get();
  if (!bill) return false;
  if (bill.suggestions) {
    await client.sendMessage(chatId, renderSuggestions(JSON.parse(bill.suggestions)));
    return true;
  }
  const profile = getProfileRow(db, userId);
  const prev = priorBill(db, userId, bill.billId, bill.createdAt);
  const payload = await generateSuggestions(
    {
      utilityType: bill.utilityType,
      amount: bill.amount,
      term: bill.term,
      details: JSON.parse(bill.details ?? "{}"),
    },
    profile
      ? { household: JSON.parse(profile.household), behaviour: JSON.parse(profile.behaviour) }
      : null,
    prev ? { utilityType: prev.utilityType, amount: prev.amount, term: prev.term, details: JSON.parse(prev.details ?? "{}") } : null,
  );
  if (!payload) {
    await client.sendMessage(chatId, copy.insightsFailed);
    return false;
  }
  // Claim the bill atomically: only the first generator wins (legacy
  // set_bill_suggestions_if_absent). A second concurrent run (button tap while
  // the capture-spawned task is in flight) loses and sends nothing.
  const claim = db
    .update(schema.bills)
    .set({ suggestions: JSON.stringify(payload) })
    .where(and(eq(schema.bills.id, billRowId), isNull(schema.bills.suggestions)))
    .run();
  if (!claim.changes) return false;
  replaceGoalsForBill(db, userId, billRowId, targetsAsGoals(payload.targets, billRowId));
  await client.sendMessage(chatId, renderSuggestions(payload));
  logMessage(db, userId, client.channel, "bot", renderSuggestions(payload), { kind: "insights", billId: billRowId });
  return true;
}

function spawnInsights(client: BotClient, chatId: string, userId: string, billRowId: string, db: DB): void {
  void generateAndSendInsights(client, chatId, userId, billRowId, db).catch((e) =>
    console.error("[bot] insights task failed:", e),
  );
}

// --- Capture ----------------------------------------------------------------

async function runCapture(
  client: BotClient,
  chatId: string,
  userId: string,
  input: { text?: string; imageBytes?: Buffer; pdfBytes?: Buffer },
  db: DB,
): Promise<void> {
  const res = await captureBill(userId, input, db);
  if (!res.ok) {
    await client.sendMessage(chatId, res.error);
    return;
  }
  await client.sendMessage(chatId, res.summary, {
    keyboard: {
      inline: [
        [
          { text: copy.showInsights, callbackData: `insights:${res.billId}` },
          ...(miniAppUrl() ? [{ text: copy.openApp, webAppUrl: miniAppUrl()! }] : []),
        ],
      ],
    },
  });
  logMessage(db, userId, client.channel, "bot", res.summary, { kind: "bill_capture", billId: res.billId });
  // Insights go out as a follow-up message; the summary reply is not delayed on the LLM.
  await client.sendMessage(chatId, copy.insightsPending);
  spawnInsights(client, chatId, userId, res.billId, db);
}

// --- Update entry ------------------------------------------------------------

export async function handleBotUpdate(
  client: BotClient,
  update: Record<string, any>,
  db: DB = getDb(),
): Promise<void> {
  const msg = update.message ?? update.edited_message;
  const cb = update.callback_query;

  if (cb) {
    await client.answerCallback(String(cb.id)); // 10-second rule: answer first
    const chatId = String(cb.message?.chat?.id ?? cb.from?.id ?? "");
    if (!chatId) return;
    const { user } = resolveUser(
      client.channel,
      {
        externalId: String(cb.from.id),
        displayName: cb.from.first_name,
        username: cb.from.username,
      },
      db,
    );
    if (user.isBlocked) return; // silent drop — admin block applies to the bot too
    const data = String(cb.data ?? "");
    if (data.startsWith("insights:")) {
      await generateAndSendInsights(client, chatId, user.id, data.slice("insights:".length), db);
    } else if (data.startsWith("onb:util:")) {
      const util = data.slice("onb:util:".length);
      updateProfileParts(db, user.id, { household: { main_utility: util } });
      setOnbStep(db, user.id, null);
      const city = (JSON.parse(getProfileRow(db, user.id)?.household ?? "{}") as Record<string, unknown>).city ?? "شهرت";
      await client.sendMessage(chatId, copy.onboardingDone(String(city)) + "\n\n" + copy.billPrompt, appKeyboard() ? { keyboard: appKeyboard() } : undefined);
    }
    return;
  }

  if (!msg?.from) return;
  const chatId = String(msg.chat?.id ?? msg.from.id);
  const { user } = resolveUser(
    client.channel,
    {
      externalId: String(msg.from.id),
      displayName: msg.from.first_name,
      username: msg.from.username,
    },
    db,
  );
  if (user.isBlocked) return; // silent drop — admin block applies to the bot too
  await client.sendChatAction(chatId);

  // Bill photo (take the largest size).
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    logMessage(db, user.id, client.channel, "user", "[عکس قبض]");
    try {
      const largest = msg.photo[msg.photo.length - 1];
      if ((largest.file_size ?? 0) > MAX_UPLOAD_BYTES) {
        await client.sendMessage(chatId, copy.tooLarge);
        return;
      }
      const bytes = await client.downloadFile(await client.getFile(largest.file_id));
      const guard = guardUploadBytes(bytes);
      if (!guard.ok) {
        await client.sendMessage(chatId, copy.photoFailed);
        return;
      }
      await runCapture(client, chatId, user.id, { imageBytes: bytes }, db);
    } catch (e) {
      console.error("[bot] photo billing failed:", e);
      await client.sendMessage(chatId, copy.photoFailed);
    }
    return;
  }

  // Documents: bill PDFs or images sent as file.
  if (msg.document) {
    const name = String(msg.document.file_name ?? "").toLowerCase();
    if ((msg.document.file_size ?? 0) > MAX_UPLOAD_BYTES) {
      await client.sendMessage(chatId, copy.tooLarge);
      return;
    }
    logMessage(db, user.id, client.channel, "user", `[فایل قبض ${name}]`);
    try {
      const bytes = await client.downloadFile(await client.getFile(msg.document.file_id));
      const guard = guardUploadBytes(bytes, name);
      if (!guard.ok) {
        await client.sendMessage(chatId, guard.error);
        return;
      }
      await runCapture(client, chatId, user.id, guard.kind === "pdf" ? { pdfBytes: bytes } : { imageBytes: bytes }, db);
    } catch (e) {
      console.error("[bot] document billing failed:", e);
      await client.sendMessage(chatId, copy.photoFailed);
    }
    return;
  }

  const text = String(msg.text ?? "").trim();
  if (!text) return;
  logMessage(db, user.id, client.channel, "user", text);

  // Commands.
  const [cmd] = text.split(/\s+/, 1);
  if (cmd === "/start") {
    // /start on an in-progress onboarding re-sends the pending step (legacy parity).
    const step = onbStep(db, user.id);
    if (step === "city") {
      await client.sendMessage(chatId, copy.onboardingCity);
      return;
    }
    if (step === "utility") {
      await sendUtilityPrompt(client, chatId);
      return;
    }
    const city = (JSON.parse(getProfileRow(db, user.id)?.household ?? "{}") as Record<string, unknown>).city;
    if (!city) {
      setOnbStep(db, user.id, "city");
      await client.sendMessage(chatId, copy.intro + "\n\n" + copy.onboardingCity);
      return;
    }
    await client.sendMessage(chatId, copy.help, appKeyboard() ? { keyboard: appKeyboard() } : undefined);
    return;
  }
  if (cmd === "/help") {
    await client.sendMessage(chatId, copy.help, appKeyboard() ? { keyboard: appKeyboard() } : undefined);
    return;
  }
  if (cmd === "/bill") {
    await client.sendMessage(chatId, copy.billPrompt);
    return;
  }
  if (cmd === "/web") {
    const base = env.publicBaseUrl();
    if (!base) {
      await client.sendMessage(chatId, copy.webNotConfigured);
      return;
    }
    const { mintLoginToken } = await import("@/lib/auth/loginTokens");
    const token = await mintLoginToken(user.id, db);
    const url = `${base.replace(/\/$/, "")}/login?t=${token}`;
    await client.sendMessage(chatId, copy.webLogin, {
      keyboard: { inline: [[{ text: copy.openApp, url }]] },
    });
    return;
  }

  // Onboarding-lite answers.
  const step = onbStep(db, user.id);
  if (step === "city") {
    const city = text.replace(/\s+/g, " ").slice(0, 60);
    updateProfileParts(db, user.id, { household: { city } });
    setOnbStep(db, user.id, "utility");
    await sendUtilityPrompt(client, chatId);
    return;
  }
  if (step === "utility") {
    // Free-typed answer also works (no button tap).
    const util = text.includes("گاز") ? "gas" : text.includes("برق") ? "electricity" : "both";
    updateProfileParts(db, user.id, { household: { main_utility: util } });
    setOnbStep(db, user.id, null);
    const city = (JSON.parse(getProfileRow(db, user.id)?.household ?? "{}") as Record<string, unknown>).city ?? "شهرت";
    await client.sendMessage(chatId, copy.onboardingDone(String(city)) + "\n\n" + copy.billPrompt);
    return;
  }

  // A bare bill id typed in looks like ordinary text — route it to billing first.
  try {
    parseBillNumbers(text);
    await runCapture(client, chatId, user.id, { text }, db);
    return;
  } catch (e) {
    if (!(e instanceof InvalidBillNumbersError)) throw e;
  }

  // Free chat (v2): grounded in the KB + user context.
  let reply: string;
  try {
    const { answerChat, extractMemory } = await import("@/lib/chat/pipeline");
    const res = await answerChat(user.id, text, db);
    reply = res.reply;
    logMessage(db, user.id, client.channel, "bot", reply, { kind: "chat" });
    void extractMemory(user.id, text, reply, db).catch(() => undefined);
  } catch (e) {
    console.error("[bot] chat failed:", e);
    reply = copy.chatError;
  }
  await client.sendMessage(chatId, reply);
}
