// Next.js server startup hook: DB init/migration, admin bootstrap, bot pollers.
// Runs once per server process (guarded), never during `next build`.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return; // never boot bots during build
  const g = globalThis as typeof globalThis & { __energybotStarted?: boolean };
  if (g.__energybotStarted) return;
  g.__energybotStarted = true;

  const { getDb } = await import("@/lib/db");
  getDb(); // opens SQLite + applies pending migrations

  const { env } = await import("@/lib/env");
  if (env.sessionSecret().length < 32) {
    console.warn("[startup] SESSION_SECRET is unset or shorter than 32 chars — set a strong value in production");
  }

  // Housekeeping: drop expired sessions and consumed/expired login tokens.
  const { lt, isNotNull, and: dbAnd } = await import("drizzle-orm");
  const { schema, now } = await import("@/lib/db");
  const db = getDb();
  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now())).run();
  db.delete(schema.loginTokens)
    .where(dbAnd(isNotNull(schema.loginTokens.usedAt), lt(schema.loginTokens.expiresAt, now())))
    .run();

  const { bootstrapAdmin } = await import("@/lib/admin/bootstrap");
  await bootstrapAdmin().catch((e) => console.error("[startup] admin bootstrap failed:", e));

  const { Poller } = await import("@/lib/channels/poller");
  const { handleBotUpdate } = await import("@/lib/bot/handler");
  const { copy } = await import("@/content/copy");

  const g2 = globalThis as typeof globalThis & {
    __energybotPollers?: import("@/lib/channels/poller").Poller[];
  };

  if (env.baleEnabled() && env.baleToken()) {
    const { BaleClient } = await import("@/lib/channels/bale");
    const client = BaleClient.fromEnv();
    await client.setMyCommands([...copy.commandsMenu]);
    const poller = new Poller(client, env.balePollTimeout(), (u) => handleBotUpdate(client, u));
    (g2.__energybotPollers ??= []).push(poller);
    void poller.run().catch((e) => console.error("[bale] poller crashed:", e));
  }

  if (env.telegramEnabled() && env.telegramToken()) {
    const { TelegramClient } = await import("@/lib/channels/telegram");
    const client = TelegramClient.fromEnv();
    await client.setMyCommands([...copy.commandsMenu]);
    const poller = new Poller(client, env.telegramPollTimeout(), (u) => handleBotUpdate(client, u));
    (g2.__energybotPollers ??= []).push(poller);
    void poller.run().catch((e) => console.error("[telegram] poller crashed:", e));
  }
}
