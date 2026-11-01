CREATE TABLE "patient_favorite" (
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
	"user_id" uuid NOT NULL,
	"active" boolean NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_patient" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_scope_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role_id" uuid,
	"entity" text NOT NULL,
	"rule" jsonb NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE INDEX "patient_favorite_user_idx" ON "patient_favorite" USING btree ("tenant_id","user_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_patient_uq" ON "device_patient" USING btree ("tenant_id","device_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_scope_rule_default_uq" ON "sync_scope_rule" USING btree ("tenant_id","entity") WHERE "sync_scope_rule"."role_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_scope_rule_role_uq" ON "sync_scope_rule" USING btree ("tenant_id","entity","role_id") WHERE "sync_scope_rule"."role_id" is not null;