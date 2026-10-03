// Next.js server startup hook: DB init/migration, admin bootstrap, bot pollers.
// Runs once per server process (guarded), never during `next build`.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as typeof globalThis & { __energybotStarted?: boolean };
  if (g.__energybotStarted) return;
  g.__energybotStarted = true;

  const { getDb } = await import("@/lib/db");
  getDb(); // opens SQLite + applies pending migrations

  const { bootstrapAdmin } = await import("@/lib/admin/bootstrap");
  await bootstrapAdmin().catch((e) => console.error("[startup] admin bootstrap failed:", e));

  const { env } = await import("@/lib/env");
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
