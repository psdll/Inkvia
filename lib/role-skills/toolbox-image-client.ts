import {
  startToolboxRoleSkillPrompt,
  waitForToolboxRoleSkillPrompt,
  type ToolboxRoleSkillTask,
} from "@/lib/role-skills/toolbox-surface-client";

export {
  startToolboxRoleSkillPrompt,
  waitForToolboxRoleSkillPrompt,
};

export type ToolboxImageRoleSkillTask = ToolboxRoleSkillTask;

export function startToolboxImageRoleSkillPrompt(
  input: Omit<Parameters<typeof startToolboxRoleSkillPrompt>[0], "surface">,
) {
  return startToolboxRoleSkillPrompt({
    ...input,
    surface: "toolbox_image",
  });
}

export function waitForToolboxImageRoleSkillPrompt(
  input: Omit<Parameters<typeof waitForToolboxRoleSkillPrompt>[0], "surface">,
) {
  return waitForToolboxRoleSkillPrompt({
    ...input,
    surface: "toolbox_image",
  });
}
