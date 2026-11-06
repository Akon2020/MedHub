CREATE TABLE "vital_sign_definition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"plausible_min" double precision NOT NULL,
	"plausible_max" double precision NOT NULL,
	"stability_margin" double precision,
	"normal_ranges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vital_sign_definition_code_uq" ON "vital_sign_definition" USING btree ("tenant_id","code");