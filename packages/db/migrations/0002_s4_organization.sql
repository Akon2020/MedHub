CREATE TABLE "department" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"cost_center_code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "department_kind_check" CHECK ("department"."kind" in ('clinical','technical','administrative','pharmacy','laboratory','cashier'))
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "mfa_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "rotated_from" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "department_code_uq" ON "department" USING btree ("tenant_id","site_id","code");