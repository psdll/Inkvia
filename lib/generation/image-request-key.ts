import { v5 as uuidv5, validate as validateUuid } from "uuid";

const IMAGE_TASK_REQUEST_NAMESPACE = "6d1805f3-eabc-47c6-948a-905d076e8a2d";

export function classifyExistingImageGenerationReplay(input: {
  status: string;
  localPath: string | null;
  errorMsg: string | null;
}) {
  if (input.status === "failed") {
    return {
      status: "failed" as const,
      error: String(input.errorMsg || "生成失败"),
    };
  }
  if (input.localPath || input.status === "success") {
    return {
      status: "success" as const,
      outputPaths: input.localPath ? [input.localPath] : undefined,
    };
  }
  return { status: "running" as const };
}

export function normalizeImageSubmissionRequestKey(value: unknown) {
  const requestKey = String(value || "").trim().toLowerCase();
  if (!requestKey) return undefined;
  if (!validateUuid(requestKey)) {
    throw new Error("requestKey 必须是有效的 UUID");
  }
  return requestKey;
}

export function deriveImageTaskRequestKey(requestKey: unknown, batchIndex: unknown) {
  const normalized = normalizeImageSubmissionRequestKey(requestKey);
  if (!normalized) return undefined;
  const index = Number(batchIndex);
  if (!Number.isInteger(index) || index < 1) {
    throw new Error("batchIndex 必须是从 1 开始的整数");
  }
  return uuidv5(`${normalized}:${index}`, IMAGE_TASK_REQUEST_NAMESPACE);
}
