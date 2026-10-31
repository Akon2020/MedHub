CREATE TABLE "duplicate_candidate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"patient_a_id" uuid NOT NULL,
	"patient_b_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	CONSTRAINT "duplicate_candidate_status_check" CHECK ("duplicate_candidate"."status" in ('open','dismissed','merged')),
	CONSTRAINT "duplicate_candidate_order_check" CHECK ("duplicate_candidate"."patient_a_id" < "duplicate_candidate"."patient_b_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_candidate_pair_uq" ON "duplicate_candidate" USING btree ("tenant_id","patient_a_id","patient_b_id");--> statement-breakpoint
CREATE INDEX "duplicate_candidate_status_idx" ON "duplicate_candidate" USING btree ("tenant_id","status","score");