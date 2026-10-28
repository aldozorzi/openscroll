ALTER TABLE "sources" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_failure_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_consecutive_failures_check" CHECK ("consecutive_failures" >= 0);
