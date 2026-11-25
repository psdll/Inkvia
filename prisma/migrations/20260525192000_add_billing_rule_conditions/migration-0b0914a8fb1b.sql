ALTER TABLE "BillingPriceRule" ADD COLUMN "matchConditions" JSONB;
ALTER TABLE "BillingPriceRule" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "BillingPriceRule_priority_idx" ON "BillingPriceRule"("priority");
