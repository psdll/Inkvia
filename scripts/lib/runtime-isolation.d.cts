import type { PrismaClient, Prisma } from "@prisma/client";
export type RuntimePolicy = Readonly<{
  schemaVersion: 1;
  profile: "local" | "test" | "build" | "production";
  projectRoot: string;
  runtimeRoot?: string;
  database: { endpointId: string; databaseName: string; roleName: string; instanceId: string };
  writableRoots: readonly string[];
  networkMode: "business" | "mock" | "explicit-test" | "production";
  allowedTestOrigins: readonly string[];
  testGenerationLimit?: number;
  fingerprint: string;
}>;
export class RuntimeIsolationError extends Error { constructor(code: string, category: string); code: string; }
export function readRuntimePolicy(env?: Record<string, string | undefined>, cwd?: string): RuntimePolicy;
export function getRuntimePolicy(): RuntimePolicy;
export function assertWritablePath(target: string | URL | Buffer, policy?: RuntimePolicy): string;
export function assertNetworkTarget(target: string | URL, policy?: RuntimePolicy): void;
export function verifyDatabaseIdentity(client: Pick<PrismaClient, "$queryRawUnsafe">, policy?: RuntimePolicy): Promise<Record<string, string>>;
export function guardPrismaClient<T extends PrismaClient>(client: T, policy?: RuntimePolicy): T;
export function createGuardedPrismaClient(options?: Prisma.PrismaClientOptions): PrismaClient;
export function prepareRuntime(): Promise<Record<string, string>>;
export function realTarget(target: string): string;
export function within(root: string, target: string): boolean;
