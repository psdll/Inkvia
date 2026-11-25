import { startNodeTracing } from "@/lib/monitoring/tracing";

export const shutdownNodeTracing = startNodeTracing("inkvia-web");
