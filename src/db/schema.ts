import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema layout
 *
 * Raw, participant-provided data (sessions, consents, transcript turns, answers,
 * rewards) is kept in separate tables from AI-derived inferences
 * (session_insights, campaign_insights). Inferences can be deleted and
 * regenerated at any time without touching what the participant actually said.
 *
 * Row level security is enabled on every table with no policies, so nothing is
 * reachable through Supabase's public REST API. All access goes through the
 * server, which connects with the database owner role.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const campaignStatus = pgEnum("campaign_status", [
  "draft",
  "published",
  "paused",
]);
export const rewardKind = pgEnum("reward_kind", ["generated", "static"]);
export const sessionStatus = pgEnum("session_status", ["started", "completed"]);
export const sessionMode = pgEnum("session_mode", ["voice", "text"]);
export const turnRole = pgEnum("turn_role", ["assistant", "user"]);
export const analysisStatus = pgEnum("analysis_status", [
  "pending",
  "processing",
  "done",
  "failed",
]);
export const emailStatus = pgEnum("email_status", [
  "pending",
  "sent",
  "failed",
  "skipped",
]);

/** A merchant or creator account. `id` is the Supabase Auth user id. */
export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  brandName: text("brand_name").notNull(),
  createdAt: createdAt(),
}).enableRLS();

/** A campaign is one public DAP Link: a product, questions and a reward. */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    status: campaignStatus("status").notNull().default("draft"),
    productName: text("product_name").notNull(),
    productDescription: text("product_description").notNull().default(""),
    productImageUrl: text("product_image_url"),
    rewardHeadline: text("reward_headline").notNull(),
    rewardKind: rewardKind("reward_kind").notNull().default("generated"),
    rewardCodePrefix: text("reward_code_prefix").notNull().default("DAP"),
    rewardStaticCode: text("reward_static_code"),
    rewardInstructions: text("reward_instructions").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("campaigns_slug_key").on(t.slug),
    index("campaigns_merchant_idx").on(t.merchantId),
  ],
).enableRLS();

/**
 * Merchant questions. Removed questions are archived, not deleted, so answers
 * already collected keep pointing at the question they were given for.
 */
export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("questions_campaign_idx").on(t.campaignId, t.position)],
).enableRLS();

/**
 * A person who has taken part. Global rather than per campaign so that future
 * DAP products can attach their own data to the same participant.
 */
export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("participants_email_key").on(t.email)],
).enableRLS();

/** One visit to a DAP Link, from consent to reward. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "set null",
    }),
    /** SHA-256 of the bearer token the browser holds for this session. */
    tokenHash: text("token_hash").notNull(),
    status: sessionStatus("status").notNull().default("started"),
    mode: sessionMode("mode").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    /**
     * True when this person had already completed the campaign in an earlier
     * session. Duplicates keep their transcript but are left out of analytics.
     */
    isDuplicate: boolean("is_duplicate").notNull().default(false),
    /** Campaign/link source, e.g. ?src=instagram. */
    source: text("source"),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    deviceType: text("device_type"),
    /** Salted hash of the IP. The raw address is never stored. */
    ipHash: text("ip_hash"),
    geoCountry: text("geo_country"),
    geoRegion: text("geo_region"),
    geoCity: text("geo_city"),
    analysisStatus: analysisStatus("analysis_status")
      .notNull()
      .default("pending"),
    analysisAttempts: integer("analysis_attempts").notNull().default(0),
    analysisStartedAt: timestamp("analysis_started_at", { withTimezone: true }),
  },
  (t) => [
    index("sessions_campaign_idx").on(t.campaignId, t.startedAt),
    index("sessions_participant_idx").on(t.participantId),
  ],
).enableRLS();

/** What the participant agreed to, stored with the session it applies to. */
export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** Version of the consent wording shown, so wording changes are traceable. */
    version: text("version").notNull(),
    responses: boolean("responses").notNull(),
    aiAnalysis: boolean("ai_analysis").notNull(),
    approximateLocation: boolean("approximate_location").notNull(),
    microphone: boolean("microphone").notNull(),
    audioRecording: boolean("audio_recording").notNull().default(false),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("consents_session_key").on(t.sessionId)],
).enableRLS();

/** Every utterance in the interview, in order. Raw data. */
export const transcriptTurns = pgTable(
  "transcript_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** Id assigned by the client, which makes saving a turn idempotent. */
    clientTurnId: text("client_turn_id").notNull(),
    seq: integer("seq").notNull(),
    role: turnRole("role").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("transcript_turns_client_key").on(t.sessionId, t.clientTurnId),
    index("transcript_turns_session_idx").on(t.sessionId, t.seq),
  ],
).enableRLS();

/** The participant's own words for each merchant question. */
export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("answers_session_question_key").on(t.sessionId, t.questionId)],
).enableRLS();

/** The discount code given to a participant for a campaign. */
export const rewards = pgTable(
  "rewards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    kind: rewardKind("kind").notNull(),
    code: text("code").notNull(),
    /** pending = not sent yet, or a temporary failure that will be retried. */
    emailStatus: emailStatus("email_status").notNull().default("pending"),
    emailAttempts: integer("email_attempts").notNull().default(0),
    emailAttemptedAt: timestamp("email_attempted_at", { withTimezone: true }),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One reward per person per campaign: repeat submissions get the same code.
    uniqueIndex("rewards_campaign_participant_key").on(
      t.campaignId,
      t.participantId,
    ),
    uniqueIndex("rewards_session_key").on(t.sessionId),
    uniqueIndex("rewards_generated_code_key")
      .on(t.campaignId, t.code)
      .where(sql`${t.kind} = 'generated'`),
  ],
).enableRLS();

/**
 * AI-derived analysis of one session. The columns are the fields the dashboard
 * aggregates; `data` holds the full structured output.
 */
export const sessionInsights = pgTable(
  "session_insights",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => sessions.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    sentiment: text("sentiment").notNull(),
    sentimentConfidence: real("sentiment_confidence").notNull(),
    purchaseIntent: text("purchase_intent").notNull(),
    purchaseLikelihood: real("purchase_likelihood"),
    purchaseIntentConfidence: real("purchase_intent_confidence").notNull(),
    priceSensitivity: text("price_sensitivity").notNull(),
    priceSensitivityConfidence: real("price_sensitivity_confidence").notNull(),
    willingnessToPay: numeric("willingness_to_pay", { precision: 12, scale: 2 }),
    willingnessToPayCurrency: text("willingness_to_pay_currency"),
    summary: text("summary").notNull(),
    data: jsonb("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("session_insights_campaign_idx").on(t.campaignId)],
).enableRLS();

/** AI-derived patterns across all analysed sessions of a campaign. Cached. */
export const campaignInsights = pgTable("campaign_insights", {
  campaignId: uuid("campaign_id")
    .primaryKey()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  /** How many analysed sessions the summary was built from. */
  sessionsIncluded: integer("sessions_included").notNull(),
  data: jsonb("data").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

/** Fixed-window request counters used for rate limiting. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
).enableRLS();

export type Merchant = typeof merchants.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type TranscriptTurn = typeof transcriptTurns.$inferSelect;
export type Reward = typeof rewards.$inferSelect;
export type SessionInsightRow = typeof sessionInsights.$inferSelect;
export type CampaignInsightRow = typeof campaignInsights.$inferSelect;
