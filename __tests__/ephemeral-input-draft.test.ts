import { describe, expect, it } from "vitest";
import { createEphemeralInputDraftRegistry } from "@/lib/ephemeral-input-draft";

describe("ephemeral input draft registry", () => {
  it("keeps inputs across route remounts in one document", () => {
    const registry = createEphemeralInputDraftRegistry();
    const draft = {
      prompt: "保留当前输入",
      selectedSkillId: "skill-1",
      mediaIds: ["media-1"],
    };

    registry.write("toolbox:image", "7", draft);

    expect(registry.read<typeof draft>("toolbox:image", "7")).toEqual(draft);
  });

  it("starts empty in a new document registry", () => {
    const currentDocument = createEphemeralInputDraftRegistry();
    currentDocument.write("batch:image:multi_prompt", "7", { prompt: "只在当前标签页" });

    const reloadedDocument = createEphemeralInputDraftRegistry();

    expect(reloadedDocument.read("batch:image:multi_prompt", "7")).toBeNull();
  });

  it("isolates users and independent product surfaces", () => {
    const registry = createEphemeralInputDraftRegistry();
    registry.write("batch:image:multi_prompt", "7", { prompt: "A" });

    expect(registry.read("batch:image:style_replication", "7")).toBeNull();
    expect(registry.read("batch:image:multi_prompt", "8")).toBeNull();
  });

  it("can clear every input owned by an account without touching another account", () => {
    const registry = createEphemeralInputDraftRegistry();
    registry.write("toolbox:image", "7", { prompt: "A" });
    registry.write("toolbox:video", "7", { prompt: "B" });
    registry.write("toolbox:image", "8", { prompt: "C" });

    registry.clearOwner("7");

    expect(registry.read("toolbox:image", "7")).toBeNull();
    expect(registry.read("toolbox:video", "7")).toBeNull();
    expect(registry.read("toolbox:image", "8")).toEqual({ prompt: "C" });
  });
});
