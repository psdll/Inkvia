import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BatchSettingsPanel } from "@/components/batch-workbench/batch-settings-panel";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: 1 }, loading: false, openLoginModal: vi.fn() }),
}));

type PanelProps = React.ComponentProps<typeof BatchSettingsPanel>;

function readyProps(mode: PanelProps["batch"]["mode"]): PanelProps {
  return {
    batch: {
      id: "draft", name: "Draft", mode, status: "draft", sharedPrompt: "产品摄影",
      sharedSettings: { model: "nano-banana-pro" }, version: 1,
      updatedAt: "2026-09-30T00:00:00Z", groups: [], items: [], media: [],
    },
    models: [{ id: "nano-banana-pro", label: "Nano Banana" }],
    uploading: false, uploadingRole: null, clearingRole: null,
    mediaMutationPending: false, disabled: false, authenticated: true,
    switchingMode: false, generatePending: false, segmentedPromptPending: false,
    rolePositioning: {
      open: false, hydrated: true, busy: false, authUserId: "1",
      legacySystemPrompt: "", selectedRoleSkillId: "skill-1", selectedRoleSkill: null,
      resultRoleSkill: null, reversePrompt: "", continuation: null,
      providerLabel: "", error: null, setOpen: vi.fn(), setReversePrompt: vi.fn(),
      selectRoleSkill: vi.fn(), clearRoleSkillSelection: vi.fn(), clearResult: vi.fn(),
      clearError: vi.fn(), openWithError: vi.fn(), saveNow: vi.fn(), generatePrompt: vi.fn(),
    },
    onBatchChange: vi.fn(), onModeChange: vi.fn(), onOpenLiveVideo: vi.fn(),
    onUpload: vi.fn(), onImportProductLibraryItem: vi.fn(), onRemoveMedia: vi.fn(),
    onClearMedia: vi.fn(), onLimitExceeded: vi.fn(), onAddTask: vi.fn(),
    onGenerateGroups: vi.fn(), onGenerateSegmentedPrompts: vi.fn(), onOpenPromptSplit: vi.fn(),
  };
}

function generationDisabled(props: PanelProps) {
  const html = renderToStaticMarkup(React.createElement(BatchSettingsPanel, props));
  const label = props.batch.mode === "style_replication" ? "生成分组" : "生成分段提示词";
  const button = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .find(([markup]) => markup.includes(`<span class="whitespace-nowrap">${label}`))?.[0];
  expect(button, `Expected the ${label} action`).toBeDefined();
  return /<button\b[^>]*\sdisabled=""/.test(button!);
}

describe("batch generation readiness", () => {
  it.each(["", " \n\t "])("disables reference mode for an empty prompt (%j)", (prompt) => {
    const props = readyProps("style_replication");
    props.batch.sharedPrompt = prompt;
    expect(generationDisabled(props)).toBe(true);
  });

  it("keeps reference mode disabled when only media is provided", () => {
    const props = readyProps("style_replication");
    props.batch.sharedPrompt = "";
    props.batch.media = [{
      id: "reference", itemId: null, role: "reference", position: 0,
      media: { id: "media", publicUrl: "/reference.jpg" },
    }];
    expect(generationDisabled(props)).toBe(true);
  });

  it("requires a skill for custom batches even when a prompt is present", () => {
    const props = readyProps("multi_prompt");
    props.rolePositioning.selectedRoleSkillId = null;
    expect(generationDisabled(props)).toBe(true);
  });

  it("allows reference mode with a prompt and no optional images", () => {
    expect(generationDisabled(readyProps("style_replication"))).toBe(false);
  });

  it("allows a selected skill to generate custom prompts without optional input", () => {
    const props = readyProps("multi_prompt");
    props.batch.sharedPrompt = "";
    expect(generationDisabled(props)).toBe(false);
  });

  const blockedStates: [string, (props: PanelProps) => void][] = [
    ["logged out", (props) => { props.authenticated = false; }],
    ["disabled workspace", (props) => { props.disabled = true; }],
    ["switching modes", (props) => { props.switchingMode = true; }],
    ["no model catalog", (props) => { props.models = []; }],
    ["no selected model", (props) => { props.batch.sharedSettings.model = ""; }],
    ["unavailable model", (props) => { props.batch.sharedSettings.model = "removed-model"; }],
    ["upload in progress", (props) => { props.uploading = true; }],
    ["media removal in progress", (props) => { props.mediaMutationPending = true; }],
    ["pending media", (props) => {
      props.batch.media = [{
        id: "pending", itemId: null, role: "product", position: 0, pending: true,
        media: { id: "pending", publicUrl: "blob:preview" },
      }];
    }],
    ["submitting", (props) => {
      props.generatePending = props.batch.mode === "style_replication";
      props.segmentedPromptPending = props.batch.mode === "multi_prompt";
    }],
  ];

  describe.each(["style_replication", "multi_prompt"] as const)("%s", (mode) => {
    it.each(blockedStates)("disables generation while %s", (_label, block) => {
      const props = readyProps(mode);
      block(props);
      expect(generationDisabled(props)).toBe(true);
    });
  });

  it.each(["hydrating", "running"])("disables custom batches while the skill is %s", (state) => {
    const props = readyProps("multi_prompt");
    props.rolePositioning.hydrated = state !== "hydrating";
    props.rolePositioning.busy = state === "running";
    expect(generationDisabled(props)).toBe(true);
  });
});
