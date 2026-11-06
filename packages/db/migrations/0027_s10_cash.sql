CREATE TABLE "cash_session" (
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
	"opened_at" timestamp with time zone NOT NULL,
	"opening_float" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"counted" jsonb,
	"expected" jsonb,
	"server_expected" jsonb,
	"justification" text,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "cash_session_status_check" CHECK ("cash_session"."status" in ('open','closed'))
);
--> statement-breakpoint
CREATE TABLE "payment" (
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
	"invoice_id" uuid NOT NULL,
	"cash_session_id" uuid NOT NULL,
	"method" text NOT NULL,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"invoice_currency" text NOT NULL,
	"amount_in_invoice_currency" bigint NOT NULL,
	"exchange_rate" numeric(18, 6),
	"exchange_rate_date" date,
	"exchange_rate_inverse" boolean DEFAULT false NOT NULL,
	"rounding_adjustment" bigint DEFAULT 0 NOT NULL,
	"change" bigint DEFAULT 0 NOT NULL,
	"reference" text,
	"operator" text,
	"receipt_number" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payment_method_check" CHECK ("payment"."method" in ('cash','mobile_money','card','cheque','transfer'))
);
--> statement-breakpoint
CREATE INDEX "cash_session_device_idx" ON "cash_session" USING btree ("tenant_id","device_id","opened_at");--> statement-breakpoint
CREATE INDEX "payment_invoice_idx" ON "payment" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payment_session_idx" ON "payment" USING btree ("tenant_id","cash_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_receipt_uq" ON "payment" USING btree ("tenant_id","receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_mobile_reference_uq" ON "payment" USING btree ("tenant_id","operator","reference") WHERE "payment"."method" = 'mobile_money';