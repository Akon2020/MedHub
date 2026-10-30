ALTER TABLE "device" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "revoked_by" uuid;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "allow_final_push" boolean DEFAULT false NOT NULL;