CREATE TABLE "appointment" (
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
	"resource_kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"appointment_type_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"cancel_reason" text,
	"source" text DEFAULT 'front_desk' NOT NULL,
	"notes" text,
	"reminder_status" text,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "appointment_resource_check" CHECK ("appointment"."resource_kind" in ('practitioner','department','room','equipment')),
	CONSTRAINT "appointment_status_check" CHECK ("appointment"."status" in ('booked','confirmed','arrived','no_show','cancelled','completed')),
	CONSTRAINT "appointment_source_check" CHECK ("appointment"."source" in ('front_desk','portal','recurring'))
);
--> statement-breakpoint
CREATE INDEX "appointment_resource_idx" ON "appointment" USING btree ("tenant_id","resource_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointment_patient_idx" ON "appointment" USING btree ("tenant_id","patient_id","starts_at");