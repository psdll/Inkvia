import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  createDetachedSegmentedPromptGroup: vi.fn(),
  createDetachedStyleReplicationGroup: vi.fn(),
  createStyleReplicationGroups: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/image-batch/service", () => ({
  createDetachedSegmentedPromptGroup: mocks.createDetachedSegmentedPromptGroup,
  createDetachedStyleReplicationGroup: mocks.createDetachedStyleReplicationGroup,
  createStyleReplicationGroups: mocks.createStyleReplicationGroups,
}));
vi.mock("@/lib/image-batch/http", () => ({
  imageBatchJson: (data: unknown, status = 200) => Response.json(data, { status }),
  imageBatchError: (error: unknown) => Response.json({ success: false, error: String(error) }, { status: 500 }),
}));

import { POST } from "@/app/api/image-batches/[batchId]/groups/route";

describe("segmented prompt group route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(7);
    mocks.createDetachedSegmentedPromptGroup.mockResolvedValue({
      group: { id: "segmented-group" },
    });
    mocks.createDetachedStyleReplicationGroup.mockResolvedValue({
      group: { id: "style-group" },
      templateVersion: 5,
    });
  });

  it("routes the explicit segmented kind only to the segmented service", async () => {
    const body = {
      requestKey: "22222222-2222-4222-8222-222222222222",
      sharedPrompt: "",
      sharedSettings: { model: "nano-banana-pro" },
      generatedPrompt: "【猎奇反差｜提示词1】\n正文",
      mediaSnapshots: [
        { mediaId: "media-a", position: 0 },
        { mediaId: "media-b", position: 1 },
      ],
    };
    const response = await POST(new Request(
      "http://localhost/api/image-batches/template-1/groups?detached=1&kind=segmented_prompts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ), { params: { batchId: "template-1" } });

    expect(response.status).toBe(201);
    expect(mocks.createDetachedSegmentedPromptGroup).toHaveBeenCalledWith({
      authUserId: 7,
      templateBatchId: "template-1",
      ...body,
    });
    expect(mocks.createDetachedStyleReplicationGroup).not.toHaveBeenCalled();
  });

  it("keeps the existing detached URL on the style service", async () => {
    const response = await POST(new Request(
      "http://localhost/api/image-batches/template-1/groups?detached=1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sharedPrompt: "复刻提示词",
          sharedSettings: { model: "nano-banana-pro" },
        }),
      },
    ), { params: { batchId: "template-1" } });

    expect(response.status).toBe(201);
    expect(mocks.createDetachedStyleReplicationGroup).toHaveBeenCalledTimes(1);
    expect(mocks.createDetachedSegmentedPromptGroup).not.toHaveBeenCalled();
  });
});
