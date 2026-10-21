import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/** All timestamps are epoch milliseconds (integer). JSON columns are text. */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // uuid
  displayName: text("display_name"),
  language: text("language").notNull().default("fa"),
  isBlocked: integer("is_blocked", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at"),
  legacyId: text("legacy_id").unique(),
});

export const userIdentities = sqliteTable(
  "user_identities",
  {
    id: text("id").primaryKey(), // uuid
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // 'bale' | 'telegram'
    externalId: text("external_id").notNull(), // platform user id (64-bit safe as text)
    username: text("username"),
    payload: text("payload").notNull().default("{}"), // JSON: first name, language code…
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at"),
  },
  (t) => [uniqueIndex("uq_identities_channel_external").on(t.channel, t.externalId)],
);

export const profiles = sqliteTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  household: text("household").notNull().default("{}"), // JSON
  behaviour: text("behaviour").notNull().default("{}"), // JSON
  goals: text("goals").notNull().default("[]"), // JSON array
  updatedAt: integer("updated_at").notNull(),
});

export const bills = sqliteTable(
  "bills",
  {
    id: text("id").primaryKey(), // uuid
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    billId: text("bill_id").notNull(),
    payId: text("pay_id"),
    utilityType: text("utility_type").notNull(), // electricity | gas | water | …
    amount: integer("amount").notNull(), // rial, as returned by Finnotech
    term: text("term"), // e.g. "1404/03"
    dueDate: text("due_date"),
    consumption: real("consumption"),
    details: text("details").notNull().default("{}"), // JSON normalized details
    suggestions: text("suggestions"), // JSON insights payload once generated
    createdAt: integer("created_at").notNull(),
    legacyId: text("legacy_id").unique(),
  },
  (t) => [index("ix_bills_user_created").on(t.userId, t.createdAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // bale | telegram | web | admin
    role: text("role").notNull(), // user | bot | admin
    content: text("content").notNull(),
    meta: text("meta").notNull().default("{}"), // JSON
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_messages_user_created").on(t.userId, t.createdAt)],
);

// Poller dedup. update_id sequences are per-bot, so the key is (channel, update_id).
// UNIQUE — a second process polling the same bot must not double-handle updates.
export const processedUpdates = sqliteTable(
  "processed_updates",
  {
    channel: text("channel").notNull(),
    updateId: text("update_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_processed_updates_channel_update").on(t.channel, t.updateId)],
);

export const adminUsers = sqliteTable("admin_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie value — cookie itself is never stored
    kind: text("kind").notNull(), // user | admin
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    adminId: text("admin_id").references(() => adminUsers.id, { onDelete: "cascade" }),
    issuedAt: integer("issued_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("ix_sessions_expires").on(t.expiresAt)],
);

// One-time magic login tokens minted by the bot's /web command.
export const loginTokens = sqliteTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(), // sha256 of the raw token
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    adminId: text("admin_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    meta: text("meta").notNull().default("{}"), // JSON
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_audit_created").on(t.createdAt)],
);

// --- v2: knowledge base + chat memory ------------------------------------

export const kbArticles = sqliteTable("kb_articles", {
  id: text("id").primaryKey(), // uuid
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull(),
  category: text("category").notNull(),
  tags: text("tags").notNull().default("[]"), // JSON array
  utility: text("utility"), // "electricity" | "gas" | "both" — nullable (legacy rows)
  difficulty: text("difficulty"), // "starter" | "medium" | "deep"
  minutes: integer("minutes"), // reading time
  sources: text("sources"), // JSON array of "name — detail/URL"
  objectives: text("objectives"), // JSON array (Persian)
  keyFacts: text("key_facts"), // JSON array (Persian, quiz-able)
  status: text("status").notNull().default("published"), // draft | published
  source: text("source").notNull().default("seed"), // seed | admin
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const kbChunks = sqliteTable(
  "kb_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    articleId: text("article_id")
      .notNull()
      .references(() => kbArticles.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    textNormalized: text("text_normalized").notNull(),
  },
  (t) => [index("ix_kb_chunks_article").on(t.articleId)],
);

// Long-term user memory — 5 legacy categories, soft-deleted, ~40 cap.
export const userMemories = sqliteTable(
  "user_memories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // preference | life_context | constraint | interaction_style | misc
    text: text("text").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("ix_user_memories_user").on(t.userId, t.deletedAt)],
);

// --- v3: gamification ------------------------------------------------------

// One row per lesson completion — replays allowed (engine awards XP only on
// the first completion, replays may improve the accuracy shown on the path).
export const lessonCompletions = sqliteTable(
  "lesson_completions",
  {
    id: text("id").primaryKey(), // uuid
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseSlug: text("course_slug").notNull(),
    lessonSlug: text("lesson_slug").notNull(),
    accuracy: real("accuracy").notNull(),
    firstTryAccuracy: real("first_try_accuracy").notNull(),
    xp: integer("xp").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_lesson_completions_user").on(t.userId)],
);

// Append-only XP ledger. Kinds: lesson | perfect_bonus | course_complete.
export const xpEvents = sqliteTable(
  "xp_events",
  {
    id: text("id").primaryKey(), // uuid
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull(),
    ref: text("ref").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_xp_events_user").on(t.userId)],
);

// Append-only coin ledger. Kinds: daily_lesson | course_complete | freeze_purchase.
export const coinEvents = sqliteTable(
  "coin_events",
  {
    id: text("id").primaryKey(), // uuid
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull(),
    ref: text("ref").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_coin_events_user").on(t.userId)],
);

// One row per user (upserted by the engine).
export const streakState = sqliteTable("streak_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  current: integer("current").notNull(),
  best: integer("best").notNull(),
  lastActiveDate: text("last_active_date").notNull(), // Gregorian YYYY-MM-DD, Asia/Tehran day
  freezes: integer("freezes").notNull(), // 0 | 1
  updatedAt: integer("updated_at").notNull(),
});

export const badgesEarned = sqliteTable(
  "badges_earned",
  {
    id: text("id").primaryKey(), // uuid
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badgeKey: text("badge_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_badges_earned_user_key").on(t.userId, t.badgeKey)],
);
