import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import {
  fetchWithProviderEgress,
  resolveProviderRequestContext,
} from "@/lib/providers/transport";
import {
  providerErrorSensitiveValues,
  sanitizeProviderErrorText,
} from "@/lib/providers/error-safety";
import {
  normalizeQwenImage3Params,
  getQwenImage3Size,
} from "@/lib/qwen-image-3-models";

const ENDPOINT = "/api/v1/services/aigc/image-generation/generation";
// Exact async contract: https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference
export function buildBailianQwenImageRequest(input: {
  prompt: string;
  quality?: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
}) {
  const params = normalizeQwenImage3Params(input);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Qwen-Image-3.0 缺少提示词");
  const images = input.imageUrls || [];
  if (images.length > 3) throw new Error("Qwen-Image-3.0 最多支持 3 张参考图");
  if (
    images.some(
      (url) => !/^https?:\/\//i.test(url) && !/^oss:\/\//i.test(url) && !/^data:image\//i.test(url),
    )
  )
    throw new Error("Qwen-Image-3.0 参考图需要公网 URL、百炼临时存储地址或图片 Base64");
  const size = getQwenImage3Size(params.aspectRatio, params.resolution);
  return {
    endpoint: ENDPOINT,
    body: {
      model: params.providerModel,
      input: {
        messages: [
          {
            role: "user",
            content: [...images.map((image) => ({ image })), { text: prompt }],
          },
        ],
      },
      parameters: { n: 1, ...(size ? { size } : {}), watermark: false },
    },
  };
}

export function getBailianQwenImageBase(baseUrl: string) {
  const message =
    "请在管理员 API 配置中填写百炼 HTTPS 业务空间地址、/api/v1 或 /compatible-mode/v1 基础地址";
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error(message);
  }
  if (
    /[{}<>]/.test(baseUrl) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    ![
      "",
      "/api/v1",
      "/compatible-mode/v1",
      ENDPOINT,
      "/api/v1/services/aigc/video-generation/video-synthesis",
    ].includes(url.pathname.replace(/\/+$/, ""))
  )
    throw new Error(message);
  return url.origin;
}

async function request(endpoint: string, body?: unknown) {
  const context = await resolveProviderRequestContext("bailian");
  const key = resolvedProviderApiKey(context.provider);
  const base = getBailianQwenImageBase(context.provider.baseUrl);
  const url = `${base}${endpoint}`;
  const sensitive = providerErrorSensitiveValues(
    context.decision,
    key,
    base,
    url,
  );
  try {
    const response = await fetchWithProviderEgress(context.decision, url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body
          ? {
              "Content-Type": "application/json",
              "X-DashScope-Async": "enable",
              // Lets the model read oss:// files from Bailian's temporary storage.
              "X-DashScope-OssResourceResolve": "enable",
            }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(body ? 60000 : 30000),
    });
    const raw = await response.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    if (!response.ok || !data || data.code) {
      const error = new Error(
        sanitizeProviderErrorText(
          data?.message || `百炼图片请求失败 (${response.status})`,
          sensitive,
        ),
      ) as Error & { statusCode: number };
      error.statusCode = response.ok ? 502 : response.status;
      throw error;
    }
    // DashScope's choices[].message is successful multimodal content, not an
    // error envelope. Recursively sanitizing "message" destroys signed image URLs.
    // Only the documented error messages may enter logs or persisted errors.
    if (typeof data.message === "string") data.message = sanitizeProviderErrorText(data.message, sensitive);
    if (typeof data.output?.message === "string") data.output.message = sanitizeProviderErrorText(data.output.message, sensitive);
    return data;
  } catch (error) {
    if (error instanceof Error) {
      error.message = sanitizeProviderErrorText(
        error.message,
        sensitive,
        "百炼图片请求失败",
      );
      throw error;
    }
    throw new Error("百炼图片请求失败");
  }
}

export async function bailianSubmitQwenImage(
  input: Parameters<typeof buildBailianQwenImageRequest>[0],
) {
  const built = buildBailianQwenImageRequest(input);
  // Do not retry submission: a lost response may already have created a billable task.
  const data = await request(built.endpoint, built.body);
  const taskId = String(data?.output?.task_id || "").trim();
  if (!taskId)
    throw new Error(
      "百炼未返回图片任务 ID，提交结果未知，请核对平台记录后再重试",
    );
  return { taskId };
}

export async function bailianGetQwenImageTask(taskId: string) {
  if (!taskId.trim()) throw new Error("百炼缺少图片任务 ID");
  return request(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
}

export function parseBailianQwenImageTask(detail: any) {
  const output = detail?.output;
  const providerStatus = String(output?.task_status || "").toUpperCase();
  if (providerStatus === "SUCCEEDED") {
    const urls: string[] = (
      Array.isArray(output.choices) ? output.choices : []
    ).flatMap((choice: any) =>
      (Array.isArray(choice?.message?.content)
        ? choice.message.content
        : []
      ).flatMap((part: any) =>
        typeof part?.image === "string" && /^https?:\/\//i.test(part.image)
          ? [part.image]
          : [],
      ),
    );
    return {
      kind: "done" as const,
      urls,
      providerStatus,
      providerUsage: detail.usage || null,
    };
  }
  if (["FAILED", "CANCELED", "UNKNOWN"].includes(providerStatus))
    return {
      kind: "failed" as const,
      providerStatus,
      message: sanitizeProviderErrorText(
        output?.message || "百炼图片任务失败或已过期",
      ),
    };
  if (!["PENDING", "RUNNING"].includes(providerStatus))
    throw new Error("百炼返回了未知图片任务状态");
  return { kind: "pending" as const, providerStatus };
}
