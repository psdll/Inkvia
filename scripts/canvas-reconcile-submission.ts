import { loadEnvConfig } from "@next/env";
import { prepareRuntime } from "./lib/runtime-isolation.cjs";
import { installRuntimeBoundaries } from "./lib/runtime-boundaries.cjs";

async function main() {
process.env.INKVIA_RUNTIME_PROFILE ||= "local";
loadEnvConfig(process.cwd(), process.env.INKVIA_RUNTIME_PROFILE === "local");
await prepareRuntime();
installRuntimeBoundaries();

const usage = "Usage: npm run canvas:submission:reconcile -- --step-id=123 --decision=retry_not_submitted|attach_provider_request|fail --operator=name [--provider=x --provider-request-id=y --note=text]";
function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

const stepIdValue = argument("step-id");
const decision = argument("decision");
const operator = argument("operator");
if (!/^\d+$/.test(stepIdValue) || !["retry_not_submitted", "attach_provider_request", "fail"].includes(decision) || !operator) {
  throw new Error(usage);
}

const [{ default: prisma }, { reconcileCanvasSubmissionUnknown }] = await Promise.all([
  import("@/lib/prisma"),
  import("@/lib/canvas/run-queue"),
]);

try {
  const result = await reconcileCanvasSubmissionUnknown(prisma, {
    stepId: BigInt(stepIdValue),
    decision: decision as "retry_not_submitted" | "attach_provider_request" | "fail",
    operator,
    provider: argument("provider") || undefined,
    providerRequestId: argument("provider-request-id") || undefined,
    note: argument("note") || undefined,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}
}
void main().catch(error => {
  console.error(error instanceof Error && /^ENV_|^BUILD_/.test(error.message) ? error.message : "CANVAS_RECONCILE_FAILED");
  process.exitCode = 1;
});
