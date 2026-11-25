import { defineConfig } from "vitest/config";
import base from "./vitest.config";

export default defineConfig({ ...base, test: { ...base.test,
  include: [
    "__tests__/runtime-isolation*.test.ts",
    "__tests__/runtime-generation-budget-db.integration.test.ts",
    "__tests__/admin-auth-security.test.ts",
    "__tests__/request-origin.test.ts",
    "__tests__/admin-session-route.test.ts",
    "__tests__/admin-credential-visibility-runtime.test.ts",
    "__tests__/password-crypto.test.ts",
    "__tests__/password-credentials-db.integration.test.ts",
    "__tests__/password-backfill-db.integration.test.ts",
    "__tests__/credentials-api-db.integration.test.ts",
    "__tests__/agent-v2-*.test.ts",
    "__tests__/admin-user-import-restore.test.ts",
    "__tests__/provider-transport*.test.ts",
    "__tests__/provider-result-download-egress.test.ts",
    "__tests__/canvas-import-storage-naming.test.ts",
    "__tests__/canvas-local-media-storage.test.ts",
    "__tests__/prisma-client-lifecycle.test.ts",
    "__tests__/dev-startup-migrations.test.ts",
    "__tests__/image-batch-worker.test.ts",
    "__tests__/generation-request-key-idempotency.test.ts",
  ],
  maxWorkers: 4,
  minWorkers: 1,
} });
