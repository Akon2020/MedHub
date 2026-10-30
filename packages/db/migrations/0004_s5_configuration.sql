CREATE TABLE "config_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"domain" text NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"value" jsonb NOT NULL,
	"note" text,
	"effective_from" timestamp with time zone,
	"created_by" uuid,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	CONSTRAINT "config_entry_status_check" CHECK ("config_entry"."status" in ('draft','published','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "config_entry_version_uq" ON "config_entry" USING btree ("tenant_id","key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "config_entry_draft_uq" ON "config_entry" USING btree ("tenant_id","key") WHERE "config_entry"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "config_entry_published_uq" ON "config_entry" USING btree ("tenant_id","key") WHERE "config_entry"."status" = 'published';