import type { Metadata } from "next";
import { SystemRoleSkillEditorPage } from "@/components/admin/SystemRoleSkillEditorPage";

export const metadata: Metadata = {
  title: "系统技能编辑器",
};

export default function SystemRoleSkillEditorRoute() {
  return <SystemRoleSkillEditorPage />;
}
