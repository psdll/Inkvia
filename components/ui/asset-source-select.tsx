"use client";
import { useUiLocale } from "@/i18n/ui";

import { Boxes, LayoutGrid, Sparkles, Wrench } from "lucide-react";

import {
  FrostedSelect,
  type FrostedSelectOption,
  type FrostedSelectVariant,
} from "@/components/ui/frosted-select";
import type { AssetSourceFilterValue } from "@/lib/assets/source-filter";

const ASSET_SOURCE_OPTIONS: FrostedSelectOption[] = [
  { value: "creation", label: "createDynamic.mb5e1c28822b5" },
  { value: "tool", label: "createDynamic.m685ad5410207" },
  { value: "canvas", label: "createDynamic.m3906276fd1bd" },
  { value: "agent", label: "Agent" },
  { value: "batch", label: "createDynamic.mcb7707463c16", hint: "createDynamic.m5c55a67935af", separatorBefore: true },
  {
    value: "batch:style_replication",
    label: "createDynamic.ma25c13f75ab9",
    buttonLabel: "createDynamic.m636d1358c99b",
    depth: 1,
  },
  {
    value: "batch:multi_prompt",
    label: "createDynamic.m32ba62e182e6",
    buttonLabel: "createDynamic.m14d6b77cbb9d",
    depth: 1,
  },
  {
    value: "batch:live_video",
    label: "createDynamic.mf15ae8e17415",
    buttonLabel: "createDynamic.maa9fc2d9b8d6",
    depth: 1,
  },
];

function iconForSource(value: string) {
  const source = value.startsWith("batch:") ? "batch" : value;
  if (source === "tool") return Wrench;
  if (source === "canvas") return LayoutGrid;
  if (source === "batch") return Boxes;
  return Sparkles;
}

export function AssetSourceSelect({
  value,
  onChange,
  compact = false,
  disabled = false,
  className = "",
  buttonClassName = "",
  variant = "default",
}: {
  value: AssetSourceFilterValue;
  onChange: (value: AssetSourceFilterValue) => void;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  variant?: FrostedSelectVariant;
}) {
  const { text } = useUiLocale();
  return (
    <FrostedSelect
      value={value}
      onChange={(nextValue) => onChange(nextValue as AssetSourceFilterValue)}
      options={ASSET_SOURCE_OPTIONS.map(option => ({
        ...option,
        label: option.value === "agent" ? option.label : text(option.label),
        hint: option.hint ? text(option.hint) : undefined,
        buttonLabel: option.buttonLabel ? text(option.buttonLabel) : undefined,
      }))}
      ariaLabel={text("createDynamic.m9011dfd178df")}
      side="bottom"
      compact={compact}
      disabled={disabled}
      className={className}
      buttonClassName={buttonClassName}
      variant={variant}
      showOptionLeading={variant !== "toolbar"}
      renderLeading={(option, context) => {
        if (context.placement === "option" && option.depth) {
          return <span aria-hidden="true" className="h-4 w-3 border-l border-[var(--border)]" />;
        }
        const OptionIcon = iconForSource(option.value);
        return <OptionIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-80" />;
      }}
    />
  );
}
