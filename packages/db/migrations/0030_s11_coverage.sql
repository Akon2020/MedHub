CREATE TABLE "coverage_exception" (
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
	"encounter_id" uuid,
	"reason" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"due_by" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"voucher_id" uuid,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "coverage_exception_status_check" CHECK ("coverage_exception"."status" in ('open','regularized'))
);
--> statement-breakpoint
CREATE TABLE "referral_voucher" (
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
	"contract_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"number" text NOT NULL,
	"signatory" text NOT NULL,
	"issued_on" date NOT NULL,
	"valid_until" date NOT NULL,
	"encounter_id" uuid,
	"registered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "payer_share" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "beneficiary_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "coverage" jsonb;--> statement-breakpoint
CREATE INDEX "coverage_exception_patient_idx" ON "coverage_exception" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "coverage_exception_due_idx" ON "coverage_exception" USING btree ("tenant_id","status","due_by");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_voucher_number_uq" ON "referral_voucher" USING btree ("tenant_id","contract_id","number");--> statement-breakpoint
CREATE INDEX "referral_voucher_patient_idx" ON "referral_voucher" USING btree ("tenant_id","patient_id");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_payer_share_check" CHECK ("invoice_line"."payer_share" >= 0);