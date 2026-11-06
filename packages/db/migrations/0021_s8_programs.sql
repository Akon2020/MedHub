CREATE TABLE "program" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"follow_up_interval_days" integer NOT NULL,
	"grace_days" integer DEFAULT 14 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_enrollment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"device_id" uuid,
	"hlc" text,
	"op_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	"patient_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"enrolled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"discharged_at" timestamp with time zone,
	"discharge_reason" text,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "program_enrollment_status_check" CHECK ("program_enrollment"."status" in ('active','discharged'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "program_code_uq" ON "program" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "program_enrollment_patient_idx" ON "program_enrollment" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "program_enrollment_program_idx" ON "program_enrollment" USING btree ("tenant_id","program_id","status");