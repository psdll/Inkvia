import { describe, expect, it } from "vitest";
import {
  formatFriendlyMessageForStorage,
  parseFriendlyMessageFromStorage,
  toFriendlyError,
  unknownFriendlyErrorLogMeta,
} from "@/lib/error-friendly";

describe("friendly error normalization", () => {
  it("maps exhausted balance lock errors to a Chinese billing message", () => {
    const friendly = toFriendlyError(
      "User is locked. Reason: Exhausted balance. Top up your balance in the provider dashboard. (403)"
    );

    expect(friendly.code).toBe("BILLING_OVERDUE");
    expect(friendly.title).toBe("余额不足");
    expect(friendly.message).toContain("余额不足");
    expect(friendly.action).toContain("充值");
    expect(friendly.raw).toContain("Exhausted balance");
  });

  it("maps permission errors to a Chinese permission message", () => {
    const friendly = toFriendlyError("access permissions denied. forbidden. (403)");

    expect(friendly.code).toBe("AUTH_DENIED");
    expect(friendly.message).toBe("当前账号没有调用该能力的权限。");
  });

  it("maps rate limits to a Chinese retry message", () => {
    const friendly = toFriendlyError("rate limit exceeded: too many requests (429)");

    expect(friendly.code).toBe("RATE_LIMIT");
    expect(friendly.message).toBe("当前请求过于频繁，服务暂时限流。");
  });

  it.each([
    "Provider request failed (ETIMEDOUT)",
    "Provider request failed (ECONNRESET)",
    "Provider request timed out",
  ])("maps transport failure %s to a network diagnosis", (raw) => {
    const friendly = toFriendlyError(raw);

    expect(friendly.code).toBe("NETWORK_ERROR");
    expect(friendly.title).toBe("上游连接失败");
    expect(friendly.message).toBe("服务器连接上游平台超时或中断，暂时无法确认任务结果。");
    expect(friendly.action).toContain("避免重复提交");
    expect(friendly.action).toContain("服务器到上游平台的网络链路");
    expect(friendly.action).not.toContain("代理");
  });

  it("distinguishes a completed provider result download failure from submission failure", () => {
    const friendly = toFriendlyError("远程结果已返回，但下载保存失败（ETIMEDOUT）");

    expect(friendly.code).toBe("RESULT_DOWNLOAD_FAILED");
    expect(friendly.title).toBe("结果保存失败");
    expect(friendly.message).toContain("上游平台已完成生成");
    expect(friendly.message).not.toContain("尚未成功提交");
    expect(friendly.action).toContain("避免立即重复提交");
    expect(friendly.action).toContain("上游调用记录");
    expect(friendly.action).not.toContain("代理");
  });

  it.each([401, 403, 404, 429])(
    "keeps provider result download HTTP %s failures in the result-save phase",
    (status) => {
      const friendly = toFriendlyError(`远程结果已返回，但下载保存失败（${status}）`);

      expect(friendly.code).toBe("RESULT_DOWNLOAD_FAILED");
      expect(friendly.title).toBe("结果保存失败");
    },
  );

  it("does not misclassify an upstream HTTP response as a network failure", () => {
    const friendly = toFriendlyError("Provider request failed with status code 500");

    expect(friendly.code).toBe("UNKNOWN");
  });

  it("keeps an adapter-supplied Chinese proxy diagnosis instead of pretending the task is missing", () => {
    const friendly = toFriendlyError("EasyRouter 代理线路不可达，无法访问 easyrouter.io");

    expect(friendly.code).toBe("UNKNOWN");
    expect(friendly.message).toBe("EasyRouter 代理线路不可达，无法访问 easyrouter.io");
  });

  it("warns against immediate replay when an EasyRouter response disconnects after submission", () => {
    const friendly = toFriendlyError(
      "EasyRouter 响应连接中断，提交结果未知；上游可能已完成并计费。",
    );

    expect(friendly.code).toBe("SUBMISSION_UNKNOWN");
    expect(friendly.message).toContain("提交结果未知");
    expect(friendly.action).toContain("避免立即重试");
  });

  it("shows unknown English errors as the primary message", () => {
    const raw = "Some upstream internal error happened";
    const friendly = toFriendlyError(raw);

    expect(friendly.code).toBe("UNKNOWN");
    expect(friendly.message).toBe(raw);
    expect(friendly.action).toBe("请稍后重试；如多次失败请联系管理员。");
    expect(friendly.raw).toBe(raw);
  });

  it("shows unknown English raw text when parsing unformatted legacy errors", () => {
    const raw = "Some upstream internal error happened";
    const parsed = parseFriendlyMessageFromStorage(raw);

    expect(parsed.message).toBe(raw);
    expect(parsed.raw).toBe(raw);
  });

  it("uses the raw error when a stored legacy message contains the old unknown fallback", () => {
    const raw = "The value 'image/png' is not supported for 'response_format.mime_type'. Supported values: 'image/jpeg'.";
    const stored = [
      "生成失败，可能是上游平台返回异常。",
      "",
      "[建议] 请稍后重试；如多次失败请联系管理员。",
      "",
      "[原始错误]",
      raw,
    ].join("\n");

    const parsed = parseFriendlyMessageFromStorage(stored);

    expect(parsed.message).toBe(raw);
    expect(parsed.action).toBe("请稍后重试；如多次失败请联系管理员。");
    expect(parsed.raw).toBe(raw);
  });

  it("preserves raw text when formatting and parsing stored friendly errors", () => {
    const friendly = toFriendlyError("invalid image size (422)");
    const stored = formatFriendlyMessageForStorage(friendly);
    const parsed = parseFriendlyMessageFromStorage(stored);

    expect(parsed.message).toBe("请求参数不符合接口要求。");
    expect(parsed.action).toBe("请检查参数后重试。");
    expect(parsed.raw).toBe("invalid image size (422)");
  });

  it("classifies unknown request keys as validation even when a key is named moderation", () => {
    const raw = 'Unrecognized keys: "output_format", "background", "moderation"';
    const friendly = toFriendlyError(raw);

    expect(friendly.code).toBe("VALIDATION");
    expect(friendly.raw).toBe(raw);
  });

  it("provides rule-miss metadata only for unknown errors", () => {
    const unknown = toFriendlyError("Some upstream internal error happened");
    const known = toFriendlyError("rate limit exceeded (429)");

    expect(unknownFriendlyErrorLogMeta(known)).toBeNull();
    expect(unknownFriendlyErrorLogMeta(unknown, { provider: "kie", model: "nano", status: 502 })).toMatchObject({
      friendlyErrorCode: "UNKNOWN",
      provider: "kie",
      model: "nano",
      status: 502,
      occurrenceCount: 1,
    });
  });
});

it.each(['Maximum call stack size exceeded','Cache size exceeded','at most one finalizer may hold the lock','Internal retry count exceeded'])('does not label internal failure as input count: %s',raw=>{
 expect(toFriendlyError(raw).code).not.toBe('INPUT_LIMIT');
});
it.each(['Google AI Studio 图片模型最多支持 16 张参考图','too many input images','input image count exceeds limit 16','at most 16 input images are allowed','输入图片数量超过上限','max support 16 reference images','Seedream accepts at most 14 reference images','model accepts at most 12 media paths','该模型最多支持 12 个素材文件','该模型最多支持 3 个参考视频','该模型最多支持 3 个参考音频'])('retains input count diagnosis: %s',raw=>{
 expect(toFriendlyError(raw).code).toBe('INPUT_LIMIT');
});
