DROP INDEX "tenant_code_uq";--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "training_source_id" uuid;--> statement-breakpoint
CREATE INDEX "tenant_training_source_idx" ON "tenant" USING btree ("training_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_code_uq" ON "tenant" USING btree ("code") WHERE not ("tenant"."is_training" and "tenant"."status" = 'archived');