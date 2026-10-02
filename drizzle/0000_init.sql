CREATE TYPE "public"."analysis_status" AS ENUM('pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'published', 'paused');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."reward_kind" AS ENUM('generated', 'static');--> statement-breakpoint
CREATE TYPE "public"."session_mode" AS ENUM('voice', 'text');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('started', 'completed');--> statement-breakpoint
CREATE TYPE "public"."turn_role" AS ENUM('assistant', 'user');--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_insights" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"schema_version" integer NOT NULL,
	"sessions_included" integer NOT NULL,
	"data" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_insights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"product_name" text NOT NULL,
	"product_description" text DEFAULT '' NOT NULL,
	"product_image_url" text,
	"reward_headline" text NOT NULL,
	"reward_kind" "reward_kind" DEFAULT 'generated' NOT NULL,
	"reward_code_prefix" text DEFAULT 'DAP' NOT NULL,
	"reward_static_code" text,
	"reward_instructions" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"version" text NOT NULL,
	"responses" boolean NOT NULL,
	"ai_analysis" boolean NOT NULL,
	"approximate_location" boolean NOT NULL,
	"microphone" boolean NOT NULL,
	"audio_recording" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"brand_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"kind" "reward_kind" NOT NULL,
	"code" text NOT NULL,
	"email_status" "email_status" DEFAULT 'pending' NOT NULL,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"email_attempted_at" timestamp with time zone,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rewards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session_insights" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"model" text NOT NULL,
	"schema_version" integer NOT NULL,
	"sentiment" text NOT NULL,
	"sentiment_confidence" real NOT NULL,
	"purchase_intent" text NOT NULL,
	"purchase_likelihood" real,
	"purchase_intent_confidence" real NOT NULL,
	"price_sensitivity" text NOT NULL,
	"price_sensitivity_confidence" real NOT NULL,
	"willingness_to_pay" numeric(12, 2),
	"willingness_to_pay_currency" text,
	"summary" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_insights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"participant_id" uuid,
	"token_hash" text NOT NULL,
	"status" "session_status" DEFAULT 'started' NOT NULL,
	"mode" "session_mode" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_seconds" integer,
	"is_duplicate" boolean DEFAULT false NOT NULL,
	"source" text,
	"referrer" text,
	"user_agent" text,
	"device_type" text,
	"ip_hash" text,
	"geo_country" text,
	"geo_region" text,
	"geo_city" text,
	"analysis_status" "analysis_status" DEFAULT 'pending' NOT NULL,
	"analysis_attempts" integer DEFAULT 0 NOT NULL,
	"analysis_started_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transcript_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"client_turn_id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" "turn_role" NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcript_turns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_insights" ADD CONSTRAINT "campaign_insights_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_insights" ADD CONSTRAINT "session_insights_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_insights" ADD CONSTRAINT "session_insights_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_turns" ADD CONSTRAINT "transcript_turns_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_session_question_key" ON "answers" USING btree ("session_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_slug_key" ON "campaigns" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "campaigns_merchant_idx" ON "campaigns" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_session_key" ON "consents" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_email_key" ON "participants" USING btree ("email");--> statement-breakpoint
CREATE INDEX "questions_campaign_idx" ON "questions" USING btree ("campaign_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "rewards_campaign_participant_key" ON "rewards" USING btree ("campaign_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rewards_session_key" ON "rewards" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rewards_generated_code_key" ON "rewards" USING btree ("campaign_id","code") WHERE "rewards"."kind" = 'generated';--> statement-breakpoint
CREATE INDEX "session_insights_campaign_idx" ON "session_insights" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "sessions_campaign_idx" ON "sessions" USING btree ("campaign_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_participant_idx" ON "sessions" USING btree ("participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_turns_client_key" ON "transcript_turns" USING btree ("session_id","client_turn_id");--> statement-breakpoint
CREATE INDEX "transcript_turns_session_idx" ON "transcript_turns" USING btree ("session_id","seq");