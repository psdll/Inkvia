import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountRolePositioningDraft, type AccountRolePositioningDraft } from "@/hooks/use-account-role-positioning-draft";

const emptyDraft: AccountRolePositioningDraft = {
  systemPrompt: "", reversePrompt: "", reversePromptApplied: false,
  activeReverseTaskId: null, continuation: null, selectedRoleSkillId: null, resultRoleSkill: null,
};
let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useAccountRolePositioningDraft>;
let request: ReturnType<typeof vi.fn>;

function Harness({ userId = "user-a", surface = "toolbox_video" }: {
  userId?: string; surface?: "toolbox_image" | "toolbox_video";
}) {
  current = useAccountRolePositioningDraft({ userId, surface });
  return React.createElement("output", null, current.reversePrompt);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(
    init?.method === "PUT" ? { success: true } : { success: true, draft: emptyDraft },
  )));
  vi.stubGlobal("fetch", request);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("account role draft action lifecycle", () => {
  it("keeps Effect dependencies stable through hydration, editing, and saving", async () => {
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Harness))));
    expect(current.hydrated).toBe(true);
    const actions = current;
    const initialReads = request.mock.calls.length;
    await act(async () => {
      current.setReversePrompt("Updated prompt");
      current.setReversePromptApplied(true);
      current.setResultRoleSkill({ id: "personal:1", name: "Test", revision: 1 });
    });
    expect(host.textContent).toBe("Updated prompt");
    for (const key of ["setSystemPrompt", "setReversePrompt", "setReversePromptApplied", "setActiveReverseTaskId", "setSelectedRoleSkillId", "setResultRoleSkill"] as const) {
      expect(current[key]).toBe(actions[key]);
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(request.mock.calls.filter(([, init]) => init?.method !== "PUT")).toHaveLength(initialReads);
    const saves = request.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(saves).toHaveLength(1);
    expect(JSON.parse(String(saves[0][1]?.body)).reversePrompt).toBe("Updated prompt");
    expect(current.setReversePrompt).toBe(actions.setReversePrompt);
  });

  it("continues to save into the selected account and surface after switching", async () => {
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => { await current.saveNow({ reversePrompt: "User A video" }); });
    await act(async () => root.render(React.createElement(Harness, { userId: "user-b", surface: "toolbox_image" })));
    expect(current.reversePrompt).toBe("");
    await act(async () => current.setReversePrompt("User B image"));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const saves = request.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(saves.map(([url]) => url)).toEqual([
      "/api/role-positioning/draft?surface=toolbox_video",
      "/api/role-positioning/draft?surface=toolbox_image",
    ]);
    expect(JSON.parse(String(saves[1][1]?.body)).reversePrompt).toBe("User B image");
  });
});
