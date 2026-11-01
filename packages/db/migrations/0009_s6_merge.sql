CREATE TABLE "patient_merge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"survivor_id" uuid NOT NULL,
	"merged_id" uuid NOT NULL,
	"candidate_id" uuid,
	"keep" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"survivor_before" jsonb NOT NULL,
	"merged_before" jsonb NOT NULL,
	"applied_patch" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"merged_by" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"undone_by" uuid,
	"undone_at" timestamp with time zone,
	"undo_reason" text,
	CONSTRAINT "patient_merge_status_check" CHECK ("patient_merge"."status" in ('active','undone'))
);
--> statement-breakpoint
CREATE INDEX "patient_merge_survivor_idx" ON "patient_merge" USING btree ("tenant_id","survivor_id");--> statement-breakpoint
CREATE INDEX "patient_merge_merged_idx" ON "patient_merge" USING btree ("tenant_id","merged_id");