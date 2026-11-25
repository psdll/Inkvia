-- Add financial usage ledger for auditable per-user model usage.
CREATE TABLE "BillingPriceRule" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "displayName" TEXT,
    "module" TEXT,
    "unitType" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPriceRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageLedger" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "authUserId" INTEGER,
    "username" TEXT,
    "module" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'tool',
    "generationId" INTEGER,
    "externalProvider" TEXT,
    "externalTaskId" TEXT,
    "model" TEXT NOT NULL,
    "providerModel" TEXT,
    "status" TEXT NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "unitType" TEXT NOT NULL,
    "unitCount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "costStatus" TEXT NOT NULL DEFAULT 'unpriced',
    "pricingSnapshot" JSONB,
    "requestSnapshot" JSONB,
    "usageSnapshot" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageLedger_generationId_key" ON "UsageLedger"("generationId");
CREATE INDEX "BillingPriceRule_provider_model_isActive_idx" ON "BillingPriceRule"("provider", "model", "isActive");
CREATE INDEX "BillingPriceRule_module_isActive_idx" ON "BillingPriceRule"("module", "isActive");
CREATE INDEX "UsageLedger_authUserId_occurredAt_idx" ON "UsageLedger"("authUserId", "occurredAt");
CREATE INDEX "UsageLedger_userId_occurredAt_idx" ON "UsageLedger"("userId", "occurredAt");
CREATE INDEX "UsageLedger_model_occurredAt_idx" ON "UsageLedger"("model", "occurredAt");
CREATE INDEX "UsageLedger_module_occurredAt_idx" ON "UsageLedger"("module", "occurredAt");
CREATE INDEX "UsageLedger_externalProvider_model_idx" ON "UsageLedger"("externalProvider", "model");
CREATE INDEX "UsageLedger_billable_costStatus_idx" ON "UsageLedger"("billable", "costStatus");

ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
