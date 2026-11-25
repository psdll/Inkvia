// @vitest-environment jsdom
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/use-role-skill-catalog", () => ({ useRoleSkillCatalog: () => ({ skills: [], loading: false, error: null }) }));
vi.mock("@/components/role-skills/role-skill-dialog", () => ({ RoleSkillDialog: () => null }));
vi.mock("@/lib/creative-agent/client", async original => {
  const module = await original<typeof import("@/lib/creative-agent/client")>();
  return { ...module, creativeAgentClient: { sessions: vi.fn(), capabilities: vi.fn(), session: vi.fn(), events: vi.fn(), answer: vi.fn() } };
});
vi.mock("@/lib/creative-agent/event-stream-client", () => ({ streamCreativeEvents: vi.fn(async () => { throw new Error("Use polling for this local test"); }) }));
vi.mock("@/components/creative-agent/AgentProject", () => ({ AgentProject: () => null }));
import CanvasAgentPanel from "@/components/creative-agent/CanvasAgentPanel";
import { creativeAgentClient as client, CreativeAgentClientError } from "@/lib/creative-agent/client";

it.each(["choice", "custom"])("restores a %s answer in the real panel, retains draft on network failure and retries with the same request ID", async mode => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ chat: [], image: [], video: [] }), { status: 200, headers: { "Content-Type": "application/json" } })));
  localStorage.clear(); sessionStorage.clear();
  const run = { id: "run", sessionId: "s", canvasId: 17, status: "waiting_decision" as const, createdAt: "2026-10-14", updatedAt: "2026-10-14" };
  vi.mocked(client.sessions).mockResolvedValue({ sessions: [{ id: "s", title: "角色制作", titleSource: "manual", titleMessageId: null, lastMessageId: null, messageCount: 1, createdAt: run.createdAt, updatedAt: run.updatedAt }] });
  vi.mocked(client.capabilities).mockResolvedValue({ enabled: true, ready: true, reason: null, protocolVersion: 1 });
  vi.mocked(client.session).mockResolvedValue({ sessionId: "s", messages: [], latestSequence: 1, run });
  vi.mocked(client.events).mockResolvedValue({ run, nextSequence: 1, events: [{ sequence: 1, runId: run.id, createdAt: run.createdAt, type: "decision.requested", payload: { decisionId: "d", proposalHash: "hash", title: "确认制作范围", question: "这次先做什么？", options: [], fields: [{ id: "scope", title: "范围", type: "radio", required: true, options: [{ value: "people", label: "先做角色" }] }] } }] });
  vi.mocked(client.answer).mockRejectedValueOnce(new CreativeAgentClientError("连接中断，请重试", null)).mockResolvedValueOnce({});
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(CanvasAgentPanel, { canvasId: 17, selection: { nodeIds: [], edgeIds: [], references: [] }, onPrepareMessage: async () => ({ canvasId: 17, revision: "1", selection: { nodeIds: [], edgeIds: [], references: [] } }), onCanvasCommitted: async () => {}, onLocateNode: () => {}, onClose: () => {} })));
    expect(host.textContent).toContain("确认制作范围");
    expect(host.querySelector('[role="log"] [aria-label="询问问题"]')).toBeNull();
    expect(host.querySelector('[role="log"]')?.textContent).toContain("询问中");
    expect((host.querySelector('form[style]') as HTMLElement)?.style.display).toBe("none");
    await act(async () => {
      if (mode === "choice") (host.querySelector('input[value="people"]') as HTMLInputElement).click();
      else {
        const input = host.querySelector('[aria-label="补充说明"]') as HTMLTextAreaElement;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "选项都不符合，只整理现有素材");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const submit = () => [...host.querySelectorAll("button")].find(button => button.textContent === "继续")!;
    await act(async () => submit().click());
    expect(host.textContent).toContain("连接中断");
    expect((host.querySelector('input[value="people"]') as HTMLInputElement).checked).toBe(mode === "choice");
    if (mode === "custom") expect((host.querySelector('[aria-label="补充说明"]') as HTMLTextAreaElement).value).toBe("选项都不符合，只整理现有素材");
    vi.mocked(client.events).mockResolvedValue({ run: { ...run, status: "queued" }, nextSequence: 2, events: [{ sequence: 2, runId: run.id, createdAt: run.createdAt, type: "run.status", payload: { status: "queued" } }] });
    await act(async () => { submit().click(); submit().click(); });
    expect(client.answer).toHaveBeenCalledTimes(2);
    const [first, retry] = vi.mocked(client.answer).mock.calls;
    expect(retry).toEqual(first);
    expect(first[1]).toMatchObject({ proposalHash: "hash", answer: mode === "choice" ? { values: { scope: "people" } } : { values: {}, notes: { scope: "选项都不符合，只整理现有素材" } } });
    expect(host.querySelector('[aria-label="Agent 待确认事项"]')).toBeNull();
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});
