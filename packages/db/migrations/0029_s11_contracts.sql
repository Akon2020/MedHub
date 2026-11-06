CREATE TABLE "beneficiary" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contract_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"member_number" text NOT NULL,
	"family_number" text NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"birth_date" date,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"status" text DEFAULT 'active' NOT NULL,
	"is_day_laborer" boolean DEFAULT false NOT NULL,
	CONSTRAINT "beneficiary_role_check" CHECK ("beneficiary"."role" in ('holder','spouse','child','dependent')),
	CONSTRAINT "beneficiary_status_check" CHECK ("beneficiary"."status" in ('active','suspended','left'))
);
--> statement-breakpoint
CREATE TABLE "beneficiary_movement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"beneficiary_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"effective_on" date NOT NULL,
	"source" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "beneficiary_movement_kind_check" CHECK ("beneficiary_movement"."kind" in ('entry','exit','change'))
);
--> statement-breakpoint
CREATE TABLE "contract" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payer_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"invoice_day" integer DEFAULT 25 NOT NULL,
	"price_list_id" uuid,
	"terminated_at" timestamp with time zone,
	CONSTRAINT "contract_status_check" CHECK ("contract"."status" in ('draft','active','suspended','terminated')),
	CONSTRAINT "contract_invoice_day_check" CHECK ("contract"."invoice_day" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "contract_plan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contract_id" uuid NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	CONSTRAINT "contract_plan_status_check" CHECK ("contract_plan"."status" in ('draft','published','archived'))
);
--> statement-breakpoint
CREATE TABLE "patient_coverage" (
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
	"contract_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"unlink_reason" text,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "patient_coverage_status_check" CHECK ("patient_coverage"."status" in ('active','ended'))
);
--> statement-breakpoint
CREATE TABLE "payer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_term_days" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "payer_kind_check" CHECK ("payer"."kind" in ('company','insurer','mutual','ngo','public_program'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "beneficiary_member_uq" ON "beneficiary" USING btree ("tenant_id","contract_id","member_number");--> statement-breakpoint
CREATE INDEX "beneficiary_family_idx" ON "beneficiary" USING btree ("tenant_id","contract_id","family_number");--> statement-breakpoint
CREATE INDEX "beneficiary_movement_idx" ON "beneficiary_movement" USING btree ("tenant_id","beneficiary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_code_uq" ON "contract" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_plan_version_uq" ON "contract_plan" USING btree ("tenant_id","contract_id","code","version");--> statement-breakpoint
CREATE INDEX "patient_coverage_patient_idx" ON "patient_coverage" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payer_code_uq" ON "payer" USING btree ("tenant_id","code");