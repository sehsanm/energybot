// Generic long-polling consumer for Bale/Telegram getUpdates — port of the
// legacy BalePoller discipline: deleteWebhook first, update-id dedup in the DB,
// offset advances only after the update was handled, capped backoff on errors.

import { and, eq, lt } from "drizzle-orm";
import { getDb, now, schema, type DB } from "@/lib/db";
import type { BotClient } from "./types";

export class Poller {
  private offset: number | null = null;
  private stopped = false;
  private consecutiveFailures = 0;

  constructor(
    private readonly client: BotClient,
    private readonly pollTimeout: number,
    private readonly onUpdate: (update: Record<string, any>) => Promise<void>,
    private readonly db: DB = (globalThis as any).__energybotDb ?? getDb(),
  ) {}

  stop(): void {
    this.stopped = true;
  }

  private alreadyProcessed(updateId: string): boolean {
    const existing = this.db
      .select({ id: schema.processedUpdates.updateId })
      .from(schema.processedUpdates)
      .where(
        and(
          eq(schema.processedUpdates.channel, this.client.channel),
          eq(schema.processedUpdates.updateId, updateId),
        ),
      )
      .get();
    if (existing) return true;
    this.db
      .insert(schema.processedUpdates)
      .values({ channel: this.client.channel, updateId, createdAt: now() })
      .run();
    return false;
  }

  private cleanupOldUpdates(): void {
    const day = 24 * 3600 * 1000;
    this.db.delete(schema.processedUpdates).where(lt(schema.processedUpdates.createdAt, now() - day)).run();
  }

  async run(): Promise<void> {
    // Neither platform delivers to getUpdates while a webhook is registered.
    try {
      await this.client.call("deleteWebhook");
    } catch (e) {
      console.warn(`[${this.client.channel}] deleteWebhook failed:`, String(e));
    }
    this.cleanupOldUpdates();
    console.info(`[${this.client.channel}] poller started`);
    while (!this.stopped) {
      let updates: Record<string, any>[];
      try {
        const payload: Record<string, unknown> = { timeout: this.pollTimeout };
        if (this.offset !== null) payload.offset = this.offset;
        const result = (await this.client.call("getUpdates", payload)) as Record<string, any>[];
        updates = result ?? [];
        this.consecutiveFailures = 0;
      } catch (e) {
        if (this.stopped) break;
        this.consecutiveFailures++;
        // Capped, jittered exponential backoff.
        const backoff = Math.min(30_000, 2000 * 2 ** Math.min(this.consecutiveFailures, 4));
        console.warn(
          `[${this.client.channel}] getUpdates failed (${this.consecutiveFailures}x):`,
          String(e),
        );
        await sleep(backoff + Math.random() * 1000);
        continue;
      }
      for (const upd of updates) {
        const updateId = Number(upd.update_id ?? 0);
        if (updateId > 0 && this.alreadyProcessed(String(updateId))) {
          this.offset = updateId + 1;
          continue;
        }
        try {
          await this.onUpdate(upd);
        } catch (e) {
          console.error(`[${this.client.channel}] update handler error:`, e);
        }
        if (updateId > 0) this.offset = updateId + 1;
      }
    }
    console.info(`[${this.client.channel}] poller stopped`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
