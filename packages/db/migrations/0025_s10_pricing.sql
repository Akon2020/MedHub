CREATE TABLE "exchange_rate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"from_currency" text NOT NULL,
	"to_currency" text NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"valid_from" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "exchange_rate_positive_check" CHECK ("exchange_rate"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "price" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"service_item_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date,
	CONSTRAINT "price_amount_check" CHECK ("price"."amount" >= 0),
	CONSTRAINT "price_period_check" CHECK ("price"."valid_until" is null or "price"."valid_until" > "price"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "price_list" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"currency" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "price_list_kind_check" CHECK ("price_list"."kind" in ('public','private','contract','foreigner','staff','indigent'))
);
--> statement-breakpoint
CREATE TABLE "service_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"department_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "service_item_category_check" CHECK ("service_item"."category" in ('consultation','procedure','lab','imaging','bed_day','drug','consumable','other'))
);
--> statement-breakpoint
CREATE TABLE "tax" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(9, 6) NOT NULL,
	"applies_to" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_currency" (
	"tenant_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"cash_rounding_step" bigint DEFAULT 0 NOT NULL,
	"is_accepted" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_currency_tenant_id_currency_pk" PRIMARY KEY("tenant_id","currency"),
	CONSTRAINT "tenant_currency_rounding_check" CHECK ("tenant_currency"."cash_rounding_step" >= 0)
);
--> statement-breakpoint
CREATE INDEX "exchange_rate_pair_idx" ON "exchange_rate" USING btree ("tenant_id","from_currency","to_currency","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "price_period_uq" ON "price" USING btree ("tenant_id","price_list_id","service_item_id","valid_from");--> statement-breakpoint
CREATE INDEX "price_service_idx" ON "price" USING btree ("tenant_id","service_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_code_uq" ON "price_list" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "service_item_code_uq" ON "service_item" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_code_uq" ON "tax" USING btree ("tenant_id","code");