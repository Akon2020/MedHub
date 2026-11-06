CREATE TABLE "break_glass_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"device_id" uuid,
	"hlc" text,
	"op_id" uuid,
	"supersedes_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"reason_text" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_outcome" text,
	"review_comment" text,
	CONSTRAINT "break_glass_outcome_check" CHECK ("break_glass_event"."review_outcome" is null or "break_glass_event"."review_outcome" in ('justified','to_investigate'))
);
--> statement-breakpoint
CREATE INDEX "break_glass_user_idx" ON "break_glass_event" USING btree ("tenant_id","user_id","patient_id","ends_at");--> statement-breakpoint
CREATE INDEX "break_glass_review_idx" ON "break_glass_event" USING btree ("tenant_id","reviewed_at");