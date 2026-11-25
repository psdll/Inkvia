import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  attachProviderFailureContext,
  providerFailureText,
} from "@/lib/providers/failure-capture";
import {
  formatFriendlyMessageForStorage,
  parseFriendlyMessageFromStorage,
  toFriendlyError,
} from "@/lib/error-friendly";

describe("provider failure capture", () => {
  it("preserves the sanitized upstream status, code, request id, message, and payload", () => {
    const error = Object.assign(
      new Error("Provider request failed with status code 429"),
      {
        response: {
          status: 429,
          data: {
            error: {
              code: "rate_limit_exceeded",
              message:
                "Too many requests from https://private-provider.example/v1/tasks",
              request_id: "req_123456789",
            },
            api_key: "provider-super-secret",
          },
        },
      },
    );

    const raw = providerFailureText(error, "生成失败");

    expect(raw).toContain("HTTP 429");
    expect(raw).toContain("rate_limit_exceeded");
    expect(raw).toContain("req_123456789");
    expect(raw).toContain("Too many requests");
    expect(raw).toContain("payload=");
    expect(raw).not.toContain("private-provider.example");
    expect(raw).not.toContain("provider-super-secret");
  });

  it("keeps the original upstream response when a provider adapter exposes a friendly mapped message", () => {
    const upstream = Object.assign(
      new Error("Provider request failed with status code 400"),
      {
        response: {
          status: 400,
          data: {
            error: {
              code: "InputVideoSensitiveContentDetected.PrivacyInformation",
              message: "input video contains privacy information",
            },
          },
        },
      },
    );
    const wrapped = attachProviderFailureContext(
      new Error("参考视频触发平台隐私风控，请更换素材"),
      upstream,
    );

    const stored = formatFriendlyMessageForStorage(
      toFriendlyError(providerFailureText(wrapped, "生成失败")),
    );
    const parsed = parseFriendlyMessageFromStorage(stored);

    expect(parsed.raw).toContain(
      "InputVideoSensitiveContentDetected.PrivacyInformation",
    );
    expect(parsed.raw).toContain("input video contains privacy information");
    expect(parsed.raw).not.toContain("请更换素材");
  });

  it("wires real failure capture into image, video, face, polling, and wrapped Seedance failures", () => {
    const imageSource = readFileSync(
      resolve(process.cwd(), "lib/generation/image-service.ts"),
      "utf8",
    );
    const videoSource = readFileSync(
      resolve(process.cwd(), "lib/generation/video-service.ts"),
      "utf8",
    );

    const finalizeSource = readFileSync(
      resolve(process.cwd(), "lib/generation/finalize.ts"),
      "utf8",
    );
    const seedanceSource = readFileSync(
      resolve(process.cwd(), "lib/seedance.ts"),
      "utf8",
    );

    expect(
      imageSource.match(/providerFailureText\(/g)?.length || 0,
    ).toBeGreaterThanOrEqual(5);
    expect(
      videoSource.match(/providerFailureText\(/g)?.length || 0,
    ).toBeGreaterThanOrEqual(5);

    expect(
      finalizeSource.match(/providerPayload:/g)?.length || 0,
    ).toBeGreaterThanOrEqual(4);
    expect(seedanceSource).toContain("attachProviderFailureContext");
  });
});
