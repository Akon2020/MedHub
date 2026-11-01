CREATE TABLE "patient_field_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"source" text NOT NULL,
	"op_id" uuid,
	"hlc" text,
	"device_id" uuid,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_field_history_source_check" CHECK ("patient_field_history"."source" in ('sync','merge','unmerge','review'))
);
--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "address" jsonb;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "occupation" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "marital_status" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "father_name" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "mother_name" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "contact" jsonb;--> statement-breakpoint
CREATE INDEX "patient_field_history_patient_idx" ON "patient_field_history" USING btree ("tenant_id","patient_id","changed_at");