CREATE TABLE "patient" (
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
	"person_global_id" uuid,
	"mrn" text NOT NULL,
	"official_mrn" text,
	"family_name" text NOT NULL,
	"middle_name" text,
	"given_name" text,
	"sex" text NOT NULL,
	"birth_date" date,
	"birth_date_estimated" boolean DEFAULT false NOT NULL,
	"age_at_registration" integer,
	"phone" text,
	"sensitivity" text DEFAULT 'normal' NOT NULL,
	"search_text" text NOT NULL,
	"phonetic_key" text NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merged_into_id" uuid,
	"deceased_at" timestamp with time zone,
	CONSTRAINT "patient_sex_check" CHECK ("patient"."sex" in ('M','F','U')),
	CONSTRAINT "patient_sensitivity_check" CHECK ("patient"."sensitivity" in ('normal','staff','vip','restricted'))
);
--> statement-breakpoint
CREATE TABLE "vital_sign" (
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
	"encounter_id" uuid,
	"code" text NOT NULL,
	"value" numeric(12, 3) NOT NULL,
	"unit" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"measured_by" uuid,
	"method" text,
	"is_out_of_range" boolean DEFAULT false NOT NULL,
	"plausibility_override_reason" text,
	CONSTRAINT "vital_sign_status_check" CHECK (status in ('active', 'superseded', 'entered_in_error'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"device_id" uuid,
	"ip" text,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" uuid,
	"patient_id" uuid,
	"reason" text,
	"diff" jsonb,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_access_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"patient_id" uuid NOT NULL,
	"screen" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "permission" (
	"key" text PRIMARY KEY NOT NULL,
	"module_code" text NOT NULL,
	"description" text,
	"scopes_allowed" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"target_tenant_id" uuid,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_privileged" boolean DEFAULT false NOT NULL,
	"requires_mfa" boolean DEFAULT false NOT NULL,
	"template_code" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"tenant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"scope" text DEFAULT 'tenant' NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "role_permission_tenant_id_role_id_permission_key_pk" PRIMARY KEY("tenant_id","role_id","permission_key"),
	CONSTRAINT "role_permission_scope_check" CHECK ("role_permission"."scope" in ('self','department','site','tenant','warehouse','cash_register','patient'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"username" text NOT NULL,
	"phone" text,
	"email" text,
	"display_name" text NOT NULL,
	"title" text,
	"professional_number" text,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"locale" text DEFAULT 'fr' NOT NULL,
	"default_site_id" uuid,
	"is_platform_staff" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_status_check" CHECK ("user_account"."status" in ('active','disabled','locked'))
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"site_id" uuid,
	"department_id" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"public_key" text NOT NULL,
	"user_agent" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"app_version" text,
	"status" text DEFAULT 'active' NOT NULL,
	"revoked_reason" text,
	CONSTRAINT "device_code_format" CHECK ("device"."device_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "device_kind_check" CHECK ("device"."kind" in ('desktop','laptop','tablet','phone')),
	CONSTRAINT "device_status_check" CHECK ("device"."status" in ('active','revoked','lost'))
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_status_check" CHECK ("job"."status" in ('queued','running','done','failed','dead'))
);
--> statement-breakpoint
CREATE TABLE "job_schedule" (
	"type" text PRIMARY KEY NOT NULL,
	"cron" text NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_tick" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"processed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"site_id" uuid,
	"doc_type" text NOT NULL,
	"device_id" uuid,
	"year" integer NOT NULL,
	"template" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_global" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"family_name_hash" text,
	"birth_year" integer,
	"phone_hash" text,
	"health_qr_token" text
);
--> statement-breakpoint
CREATE TABLE "site" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timezone" text DEFAULT 'Africa/Kinshasa' NOT NULL,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "site_code_format" CHECK ("site"."code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"country" text DEFAULT 'CD' NOT NULL,
	"default_locale" text DEFAULT 'fr' NOT NULL,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'Africa/Kinshasa' NOT NULL,
	"contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"billing_contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"legal_mentions" text,
	"official_numbering_required" boolean DEFAULT false NOT NULL,
	"is_training" boolean DEFAULT false NOT NULL,
	"parent_tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_code_format" CHECK ("tenant"."code" ~ '^[A-Z]{3}-[A-Z]{3}-[0-9]{4}$'),
	CONSTRAINT "tenant_type_check" CHECK ("tenant"."type" in ('pharmacy','health_center','practice','laboratory','imaging_center','clinic','hospital','network')),
	CONSTRAINT "tenant_status_check" CHECK ("tenant"."status" in ('prospect','trial','active','past_due','grace','read_only','suspended','terminated','archived'))
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
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
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" bigint,
	"unit_cost_currency" text,
	"ref_table" text,
	"ref_id" uuid,
	"reason" text,
	"approved_by" uuid,
	CONSTRAINT "stock_movement_quantity_positive" CHECK ("stock_movement"."quantity" > 0),
	CONSTRAINT "stock_movement_kind_check" CHECK ("stock_movement"."kind" in ('receipt','dispense','sale','transfer_out','transfer_in','return_supplier','return_patient','adjustment_plus','adjustment_minus','destruction','consumption','count_correction'))
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"op_id" uuid,
	"scope_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_log" (
	"op_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"command" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"hlc" text NOT NULL,
	"client_ts" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"result" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"signature" text NOT NULL,
	"clock_suspect" boolean DEFAULT false NOT NULL,
	CONSTRAINT "op_log_status_check" CHECK ("op_log"."status" in ('applied','merged','duplicate','rejected','needs_review'))
);
--> statement-breakpoint
CREATE TABLE "sync_conflict" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"op_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"server_value" jsonb,
	"client_value" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_conflict_status_check" CHECK ("sync_conflict"."status" in ('open','resolved','dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "patient_mrn_uq" ON "patient" USING btree ("tenant_id","mrn");--> statement-breakpoint
CREATE INDEX "patient_phonetic_idx" ON "patient" USING btree ("tenant_id","phonetic_key");--> statement-breakpoint
CREATE INDEX "patient_phone_idx" ON "patient" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "vital_sign_patient_idx" ON "vital_sign" USING btree ("tenant_id","patient_id","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_seq_uq" ON "audit_log" USING btree ("tenant_id","seq");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("tenant_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_patient_idx" ON "audit_log" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "data_access_patient_idx" ON "data_access_log" USING btree ("tenant_id","patient_id","at");--> statement-breakpoint
CREATE INDEX "platform_audit_tenant_idx" ON "platform_audit_log" USING btree ("target_tenant_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "role_code_uq" ON "role" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_uq" ON "session" USING btree ("tenant_id","token_hash");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_uq" ON "user_account" USING btree ("tenant_id","username");--> statement-breakpoint
CREATE INDEX "user_role_user_idx" ON "user_role" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_uq" ON "device" USING btree ("tenant_id","device_code");--> statement-breakpoint
CREATE INDEX "device_user_idx" ON "device" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "job_due_idx" ON "job" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "number_series_uq" ON "number_series" USING btree ("tenant_id","doc_type","site_id","device_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "site_code_uq" ON "site" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_code_uq" ON "tenant" USING btree ("code");--> statement-breakpoint
CREATE INDEX "stock_movement_product_idx" ON "stock_movement" USING btree ("tenant_id","warehouse_id","product_id");--> statement-breakpoint
CREATE INDEX "change_log_tenant_seq_idx" ON "change_log" USING btree ("tenant_id","seq");--> statement-breakpoint
CREATE INDEX "op_log_device_idx" ON "op_log" USING btree ("tenant_id","device_id","received_at");--> statement-breakpoint
CREATE INDEX "op_log_entity_idx" ON "op_log" USING btree ("tenant_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "sync_conflict_open_idx" ON "sync_conflict" USING btree ("tenant_id","status");