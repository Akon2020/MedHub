CREATE TABLE "triage" (
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
	"encounter_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"priority" text NOT NULL,
	"chief_complaint" text NOT NULL,
	"notes" text,
	"orientation_queue_id" uuid,
	"triaged_at" timestamp with time zone NOT NULL,
	"triaged_by" uuid,
	CONSTRAINT "triage_status_check" CHECK (status in ('active', 'superseded', 'entered_in_error')),
	CONSTRAINT "triage_priority_check" CHECK ("triage"."priority" in ('emergency','elderly','pregnant','child','normal'))
);
--> statement-breakpoint
CREATE INDEX "triage_encounter_idx" ON "triage" USING btree ("tenant_id","encounter_id");--> statement-breakpoint
CREATE INDEX "triage_patient_idx" ON "triage" USING btree ("tenant_id","patient_id");