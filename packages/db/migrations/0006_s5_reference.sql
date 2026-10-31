CREATE TABLE "admin_area" (
	"code" text PRIMARY KEY NOT NULL,
	"country" text DEFAULT 'CD' NOT NULL,
	"level" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"parent_code" text,
	"source" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "admin_area_level_check" CHECK ("admin_area"."level" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "choice_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"list_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "choice_list" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name_fr" text NOT NULL,
	"name_en" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency" (
	"code" text PRIMARY KEY NOT NULL,
	"name_fr" text NOT NULL,
	"name_en" text NOT NULL,
	"minor_unit" integer NOT NULL,
	"symbol" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"code" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"symbol" text NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	CONSTRAINT "unit_kind_check" CHECK ("unit"."kind" in ('mass','volume','length','temperature','pressure','rate','ratio','concentration','count','time'))
);
--> statement-breakpoint
CREATE INDEX "admin_area_parent_idx" ON "admin_area" USING btree ("parent_code");--> statement-breakpoint
CREATE UNIQUE INDEX "choice_item_code_uq" ON "choice_item" USING btree ("tenant_id","list_id","code");--> statement-breakpoint
CREATE INDEX "choice_item_list_idx" ON "choice_item" USING btree ("tenant_id","list_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "choice_list_code_uq" ON "choice_list" USING btree ("tenant_id","code");