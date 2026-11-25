import type { ReactNode } from "react";

export const roleSkillTagClassName =
  "mx-0.5 inline-flex min-h-[calc(1.15em+4px)] max-w-full select-none items-center whitespace-normal rounded-md border border-[var(--border)] bg-transparent px-1 py-[2px] align-[-0.18em] text-[1em] font-medium leading-none text-[var(--primary-bg)] shadow-none";

export function RoleSkillTag({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <span className={roleSkillTagClassName} title={name}>
      <span aria-hidden="true" className="h-[1.15em] w-0 shrink-0" />
      <span className="break-words">{name}</span>
      {children}
    </span>
  );
}
