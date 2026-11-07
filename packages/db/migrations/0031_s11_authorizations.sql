CREATE TABLE "guarantee" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"contract_id" uuid NOT NULL,
	"member_number" text,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guarantee_kind_check" CHECK ("guarantee"."kind" in ('receive','refund')),
	CONSTRAINT "guarantee_amount_check" CHECK ("guarantee"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "prior_authorization" (
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
	"service_item_id" uuid,
	"service_code" text,
	"label" text NOT NULL,
	"currency" text NOT NULL,
	"amount_requested" bigint NOT NULL,
	"reason" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"authorized_amount" bigint,
	"valid_until" date,
	"payer_reference" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "prior_authorization_status_check" CHECK ("prior_authorization"."status" in ('pending','approved','rejected')),
	CONSTRAINT "prior_authorization_amount_check" CHECK ("prior_authorization"."amount_requested" > 0)
);
--> statement-breakpoint
CREATE INDEX "guarantee_contract_idx" ON "guarantee" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE INDEX "prior_authorization_patient_idx" ON "prior_authorization" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "prior_authorization_status_idx" ON "prior_authorization" USING btree ("tenant_id","status","requested_at");