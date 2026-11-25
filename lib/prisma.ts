import "server-only";

import { PrismaClient } from "@prisma/client";
import { durableTaskMaintenanceGuard } from "./maintenance";
import { guardPrismaClient } from "./runtime-isolation";

const createPrismaClient = (): PrismaClient => (
  guardPrismaClient(new PrismaClient().$extends({
    query: {
      $allModels: {
        $allOperations: durableTaskMaintenanceGuard,
      },
    },
  }) as PrismaClient)
);

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
