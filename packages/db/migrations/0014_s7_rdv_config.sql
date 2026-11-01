CREATE TABLE "appointment_type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"duration_min" integer NOT NULL,
	"color" text DEFAULT '#0f6b6b' NOT NULL,
	"department_id" uuid,
	"requires_payment" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"site_id" uuid NOT NULL,
	"department_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"ticket_prefix" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "queue_prefix_format" CHECK ("queue"."ticket_prefix" ~ '^[A-Z]{1,3}$')
);
--> statement-breakpoint
CREATE TABLE "schedule_exception" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"start_time" text,
	"end_time" text,
	"slot_min" integer,
	"reason" text,
	CONSTRAINT "schedule_exception_kind_check" CHECK ("schedule_exception"."kind" in ('closed','extra')),
	CONSTRAINT "schedule_exception_resource_check" CHECK ("schedule_exception"."resource_kind" in ('practitioner','department','room','equipment'))
);
--> statement-breakpoint
CREATE TABLE "schedule_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"slot_min" integer NOT NULL,
	"overbook_max" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "schedule_template_kind_check" CHECK ("schedule_template"."resource_kind" in ('practitioner','department','room','equipment')),
	CONSTRAINT "schedule_template_weekday_check" CHECK ("schedule_template"."weekday" between 1 and 7)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_type_code_uq" ON "appointment_type" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "queue_code_uq" ON "queue" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "schedule_exception_resource_idx" ON "schedule_exception" USING btree ("tenant_id","resource_id","date");--> statement-breakpoint
CREATE INDEX "schedule_template_resource_idx" ON "schedule_template" USING btree ("tenant_id","resource_id","weekday");