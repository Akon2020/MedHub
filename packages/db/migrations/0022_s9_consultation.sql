CREATE TABLE "clinical_note" (
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
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"kind" text NOT NULL,
	"sections" jsonb NOT NULL,
	"signed_by" uuid,
	"signed_at" timestamp with time zone NOT NULL,
	"signed_op_id" uuid,
	"signed_operation" jsonb,
	"correction_reason" text,
	CONSTRAINT "clinical_note_status_check" CHECK (status in ('active', 'superseded', 'entered_in_error'))
);
--> statement-breakpoint
CREATE TABLE "diagnosis" (
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
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"code_system" text NOT NULL,
	"code" text,
	"label" text NOT NULL,
	"certainty" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"diagnosed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "diagnosis_status_check" CHECK (status in ('active', 'superseded', 'entered_in_error')),
	CONSTRAINT "diagnosis_certainty_check" CHECK ("diagnosis"."certainty" in ('suspected','confirmed'))
);
--> statement-breakpoint
CREATE TABLE "diagnosis_catalog_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code_system" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX "clinical_note_patient_idx" ON "clinical_note" USING btree ("tenant_id","patient_id","signed_at");--> statement-breakpoint
CREATE INDEX "diagnosis_patient_idx" ON "diagnosis" USING btree ("tenant_id","patient_id","diagnosed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_catalog_code_uq" ON "diagnosis_catalog_item" USING btree ("tenant_id","code_system","code");