CREATE TABLE "form_definition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"step" text NOT NULL,
	"title" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_response" (
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
	"form_version_id" uuid NOT NULL,
	"form_code" text NOT NULL,
	"data" jsonb NOT NULL,
	"state" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"signed_by" uuid,
	"correction_reason" text,
	CONSTRAINT "form_response_status_check" CHECK (status in ('active', 'superseded', 'entered_in_error')),
	CONSTRAINT "form_response_state_check" CHECK ("form_response"."state" in ('completed','signed'))
);
--> statement-breakpoint
CREATE TABLE "form_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form_definition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	CONSTRAINT "form_version_status_check" CHECK ("form_version"."status" in ('draft','published','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "form_definition_code_uq" ON "form_definition" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "form_response_patient_idx" ON "form_response" USING btree ("tenant_id","patient_id","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "form_version_uq" ON "form_version" USING btree ("tenant_id","form_definition_id","version");