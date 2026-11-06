CREATE TABLE "drug" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"inn" text NOT NULL,
	"atc_code" text,
	"form" text,
	"strength" text,
	"route" text,
	"dose_unit" text,
	"max_single_dose" double precision,
	"max_daily_dose" double precision,
	"max_daily_dose_per_kg" double precision,
	"pregnancy_category" text,
	"min_age_months" integer,
	"geriatric_caution" boolean DEFAULT false NOT NULL,
	"renal_caution" boolean DEFAULT false NOT NULL,
	"hepatic_caution" boolean DEFAULT false NOT NULL,
	"is_controlled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'local' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drug_interaction_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"atc_a" text NOT NULL,
	"atc_b" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	CONSTRAINT "drug_interaction_severity_check" CHECK ("drug_interaction_rule"."severity" in ('minor','moderate','major','contraindicated'))
);
--> statement-breakpoint
CREATE TABLE "medication_reconciliation" (
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
	"decisions" jsonb NOT NULL,
	"performed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medication_statement" (
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
	"noted_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"label" text NOT NULL,
	"atc_code" text,
	"dose" text,
	"source" text NOT NULL,
	"started_on" date,
	"stopped_on" date,
	"stop_reason" text,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "medication_statement_status_check" CHECK ("medication_statement"."status" in ('active','stopped','retracted'))
);
--> statement-breakpoint
CREATE TABLE "prescription" (
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
	"kind" text DEFAULT 'outpatient' NOT NULL,
	"prescribed_at" timestamp with time zone NOT NULL,
	"prescriber_id" uuid,
	"verification_code" text NOT NULL,
	CONSTRAINT "prescription_status_check" CHECK ("prescription"."status" in ('active','completed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "prescription_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"op_id" uuid,
	"hlc" text,
	"device_id" uuid,
	"prescription_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"drug_id" uuid,
	"drug_code" text,
	"label" text NOT NULL,
	"atc_code" text,
	"dose_value" double precision NOT NULL,
	"dose_unit" text NOT NULL,
	"route" text,
	"frequency" text NOT NULL,
	"duration_days" integer,
	"quantity" double precision,
	"instructions" text,
	"substitution_allowed" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'prescribed' NOT NULL,
	"alerts_acknowledged" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "prescription_item_status_check" CHECK ("prescription_item"."status" in ('prescribed','dispensed','partially_dispensed','administered','stopped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "drug_code_uq" ON "drug" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "drug_interaction_pair_uq" ON "drug_interaction_rule" USING btree ("tenant_id","atc_a","atc_b");--> statement-breakpoint
CREATE INDEX "medication_reconciliation_patient_idx" ON "medication_reconciliation" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "medication_statement_patient_idx" ON "medication_statement" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "prescription_patient_idx" ON "prescription" USING btree ("tenant_id","patient_id","prescribed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prescription_verification_uq" ON "prescription" USING btree ("verification_code");--> statement-breakpoint
CREATE INDEX "prescription_item_prescription_idx" ON "prescription_item" USING btree ("tenant_id","prescription_id");