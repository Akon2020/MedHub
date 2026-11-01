ALTER TABLE "patient" ADD COLUMN "is_provisional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "provisional_kind" text;--> statement-breakpoint
ALTER TABLE "patient" ADD CONSTRAINT "patient_provisional_kind_check" CHECK ("patient"."provisional_kind" is null or "patient"."provisional_kind" in ('unknown','newborn'));