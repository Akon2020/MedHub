CREATE TABLE "encounter" (
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
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"department_id" uuid,
	"practitioner_id" uuid,
	"appointment_id" uuid,
	"visit_number" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "encounter_kind_check" CHECK ("encounter"."kind" in ('outpatient','emergency','inpatient','day_care','teleconsult','lab_only','pharmacy_only')),
	CONSTRAINT "encounter_status_check" CHECK ("encounter"."status" in ('planned','arrived','triaged','in_consultation','waiting_results','completed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "queue_ticket" (
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
	"queue_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"number" text NOT NULL,
	"priority" text NOT NULL,
	"status" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"called_at" timestamp with time zone,
	"room" text,
	"service_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "queue_ticket_priority_check" CHECK ("queue_ticket"."priority" in ('emergency','elderly','pregnant','child','normal')),
	CONSTRAINT "queue_ticket_status_check" CHECK ("queue_ticket"."status" in ('waiting','called','in_service','done','left'))
);
--> statement-breakpoint
CREATE INDEX "encounter_patient_idx" ON "encounter" USING btree ("tenant_id","patient_id","started_at");--> statement-breakpoint
CREATE INDEX "encounter_day_idx" ON "encounter" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_visit_number_uq" ON "encounter" USING btree ("tenant_id","visit_number");--> statement-breakpoint
CREATE INDEX "queue_ticket_queue_idx" ON "queue_ticket" USING btree ("tenant_id","queue_id","issued_at");--> statement-breakpoint
CREATE INDEX "queue_ticket_patient_idx" ON "queue_ticket" USING btree ("tenant_id","patient_id");