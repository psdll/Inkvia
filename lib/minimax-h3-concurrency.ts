import type { Prisma } from "@prisma/client";

import {
  MINIMAX_H3_MODEL_ID,
  MINIMAX_H3_PAID_CONCURRENCY,
  MINIMAX_PROVIDER_ID,
} from "@/lib/minimax-models";
import { ToolMediaInputError } from "@/lib/tool-media/generation-inputs";

const ACTIVE_STATUSES = ["running", "queued", "pending", "processing", "submitted"];

export class MiniMaxH3ConcurrencyError extends ToolMediaInputError {
  constructor() {
    super(`MiniMax-H3 当前并发任务已达 ${MINIMAX_H3_PAID_CONCURRENCY} 个，请稍后重试。`, 429);
    this.name = "MiniMaxH3ConcurrencyError";
  }
}

export async function assertMiniMaxH3ConcurrencyAvailable(
  tx: Pick<Prisma.TransactionClient, "$executeRawUnsafe" | "generation">,
  modelId = MINIMAX_H3_MODEL_ID,
): Promise<void> {
  if (modelId !== MINIMAX_H3_MODEL_ID) return;
  await tx.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
    1296649550,
    1211302144,
  );
  const running = await tx.generation.count({
    where: {
      externalProvider: MINIMAX_PROVIDER_ID,
      model: MINIMAX_H3_MODEL_ID,
      status: { in: ACTIVE_STATUSES },
    },
  });
  if (running >= MINIMAX_H3_PAID_CONCURRENCY) {
    throw new MiniMaxH3ConcurrencyError();
  }
}
