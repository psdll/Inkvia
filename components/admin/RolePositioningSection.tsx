"use client";

import SystemRoleSkillsPanel from "@/components/admin/SystemRoleSkillsPanel";

export default function RolePositioningSection() {
  return (
    <section
      id="sys-role-positioning"
      className="scroll-mt-28 rounded-3xl border border-[var(--border)] bg-[var(--panel-bg)] p-6 shadow-sm"
    >
      <SystemRoleSkillsPanel />
    </section>
  );
}
