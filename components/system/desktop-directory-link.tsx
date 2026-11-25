"use client";
import { UiProps } from "@/i18n/ui";


import { useEffect, useState } from "react";
import { Folder } from "lucide-react";

export function DesktopDirectoryLink({ directory }: { directory: "data" | "logs" }) {
  const [windows, setWindows] = useState(false);
  useEffect(() => { setWindows(/\bWindows\b/.test(navigator.userAgent)); }, []);
  return <UiProps ids={{"aria-label":["common.mda99ea1331dc","common.m6e15bd283c30"],"title":["common.md10ec81b9024","common.mf121130e8d02"]}}><a
    href={directory === "data" ? "/__desktop/open-data-dir" : "/__desktop/open-logs-dir"}
    aria-label={directory === "data" ? "common.mda99ea1331dc" : "common.m6e15bd283c30"}
    title={windows ? "common.md10ec81b9024" : "common.mf121130e8d02"}
    className="self-center text-[var(--app-muted)] hover:text-[var(--app-fg)]"
  ><Folder className="h-4 w-4" aria-hidden="true" /></a></UiProps>;
}
