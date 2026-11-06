CREATE TABLE "billing_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"encounter_kind" text,
	"department_id" uuid,
	"service_item_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice" (
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
	"encounter_id" uuid,
	"number" text NOT NULL,
	"official_number" text,
	"currency" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"supplementary_of" uuid,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "invoice_status_check" CHECK ("invoice"."status" in ('open','finalized','voided'))
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
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
	"invoice_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"service_item_id" uuid,
	"code" text,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" bigint,
	"currency" text NOT NULL,
	"price_list_id" uuid,
	"manual_price" boolean DEFAULT false NOT NULL,
	"source_table" text,
	"source_id" uuid,
	"performed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invoice_line_status_check" CHECK ("invoice_line"."status" in ('active','superseded')),
	CONSTRAINT "invoice_line_quantity_check" CHECK ("invoice_line"."quantity" > 0),
	CONSTRAINT "invoice_line_price_check" CHECK ("invoice_line"."unit_price" is null or "invoice_line"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_rule_target_uq" ON "billing_rule" USING btree ("tenant_id","encounter_kind","department_id") WHERE "billing_rule"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_number_uq" ON "invoice" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "invoice_patient_idx" ON "invoice" USING btree ("tenant_id","patient_id","opened_at");--> statement-breakpoint
CREATE INDEX "invoice_encounter_idx" ON "invoice" USING btree ("tenant_id","encounter_id");--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_idx" ON "invoice_line" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_line_source_idx" ON "invoice_line" USING btree ("tenant_id","source_table","source_id");