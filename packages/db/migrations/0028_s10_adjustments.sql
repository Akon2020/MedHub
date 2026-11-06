CREATE TABLE "approval_request" (
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
	"kind" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "approval_request_kind_check" CHECK ("approval_request"."kind" in ('discount','credit_note')),
	CONSTRAINT "approval_request_status_check" CHECK ("approval_request"."status" in ('pending','approved','rejected')),
	CONSTRAINT "approval_request_amount_check" CHECK ("approval_request"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "approval_threshold" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"currency" text NOT NULL,
	"max_amount" bigint NOT NULL,
	CONSTRAINT "approval_threshold_kind_check" CHECK ("approval_threshold"."kind" in ('discount','credit_note')),
	CONSTRAINT "approval_threshold_amount_check" CHECK ("approval_threshold"."max_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_note" (
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
	"approval_request_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"number" text NOT NULL,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid,
	"issued_at" timestamp with time zone NOT NULL,
	CONSTRAINT "credit_note_amount_check" CHECK ("credit_note"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "discount_grant" (
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
	"approval_request_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid,
	"granted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "discount_grant_amount_check" CHECK ("discount_grant"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "refund_reason" text;--> statement-breakpoint
CREATE INDEX "approval_request_status_idx" ON "approval_request" USING btree ("tenant_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "approval_request_invoice_idx" ON "approval_request" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_threshold_uq" ON "approval_threshold" USING btree ("tenant_id","role_id","kind","currency");--> statement-breakpoint
CREATE INDEX "credit_note_invoice_idx" ON "credit_note" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_note_number_uq" ON "credit_note" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_note_request_uq" ON "credit_note" USING btree ("tenant_id","approval_request_id");--> statement-breakpoint
CREATE INDEX "discount_grant_invoice_idx" ON "discount_grant" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_grant_request_uq" ON "discount_grant" USING btree ("tenant_id","approval_request_id");