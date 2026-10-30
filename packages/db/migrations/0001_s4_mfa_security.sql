CREATE TABLE "mfa_recovery_code" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ip_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cidr" text NOT NULL,
	"action" text NOT NULL,
	"scope" text DEFAULT 'platform' NOT NULL,
	"target_tenant_id" uuid,
	"reason" text NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ip_rule_action_check" CHECK ("ip_rule"."action" in ('block','allow','monitor')),
	CONSTRAINT "ip_rule_scope_check" CHECK ("ip_rule"."scope" in ('platform','admin','tenant')),
	CONSTRAINT "ip_rule_origin_check" CHECK ("ip_rule"."origin" in ('manual','auto'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"target_tenant_id" uuid,
	"user_id" uuid,
	"ip" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "security_event_severity_check" CHECK ("security_event"."severity" in ('info','warning','critical'))
);
--> statement-breakpoint
ALTER TABLE "user_account" ADD COLUMN "mfa_secret_enc" text;--> statement-breakpoint
ALTER TABLE "user_account" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_account" ADD COLUMN "mfa_last_step" bigint;--> statement-breakpoint
CREATE INDEX "mfa_recovery_user_idx" ON "mfa_recovery_code" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "ip_rule_scope_idx" ON "ip_rule" USING btree ("scope","target_tenant_id");--> statement-breakpoint
CREATE INDEX "security_event_at_idx" ON "security_event" USING btree ("at");--> statement-breakpoint
CREATE INDEX "security_event_tenant_idx" ON "security_event" USING btree ("target_tenant_id","at");