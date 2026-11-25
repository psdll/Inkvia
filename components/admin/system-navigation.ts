export type SystemSectionKey =
  | "appearance"
  | "hotkey"
  | "language"
  | "windowClose"
  | "account"
  | "tutorial"
  | "notice"
  | "rolePositioning"
  | "segmentedPromptRule"
  | "aliyunOss"
  | "product"
  | "errorGuide"
  | "inspiration"
  | "providers"
  | "imageEditModels"
  | "billingPrices"
  | "presets"
  | "materialAssets";

export type SystemNavItem = {
  type: "item";
  key: SystemSectionKey;
  id: string;
  label: string;
};

export type SystemNavGroupKey =
  | "general"
  | "accountAccess"
  | "contentResources"
  | "aiModels"
  | "systemIntegration";

export type SystemNavGroup = {
  type: "group";
  key: SystemNavGroupKey;
  label: string;
  items: readonly [SystemNavItem, ...SystemNavItem[]];
};

export type SystemNavEntry = SystemNavGroup;

export const SYSTEM_SETTING_NAV_ENTRIES: readonly SystemNavEntry[] = [
  {
    type: "group",
    key: "accountAccess",
    label: "admin.nav_accountAccess",
    items: [
      {
        type: "item",
        key: "account",
        id: "sys-account",
        label: "admin.nav_account",
      },
    ],
  },
  {
    type: "group",
    key: "contentResources",
    label: "admin.nav_contentResources",
    items: [
      {
        type: "item",
        key: "tutorial",
        id: "sys-tutorial",
        label: "admin.nav_tutorial",
      },
      { type: "item", key: "notice", id: "sys-notice", label: "admin.nav_notice" },
      { type: "item", key: "product", id: "sys-oss", label: "admin.nav_product" },
      {
        type: "item",
        key: "errorGuide",
        id: "sys-error-guide",
        label: "admin.nav_errorGuide",
      },
      {
        type: "item",
        key: "inspiration",
        id: "sys-inspiration",
        label: "admin.nav_inspiration",
      },
      {
        type: "item",
        key: "materialAssets",
        id: "sys-material-assets",
        label: "admin.nav_materialAssets",
      },
    ],
  },
  {
    type: "group",
    key: "aiModels",
    label: "admin.nav_aiModels",
    items: [
      {
        type: "item",
        key: "imageEditModels",
        id: "sys-image-edit-models",
        label: "admin.nav_imageEditModels",
      },
      { type: "item", key: "providers", id: "sys-providers", label: "admin.nav_providers" },
      {
        type: "item",
        key: "billingPrices",
        id: "sys-billing-prices",
        label: "admin.nav_billingPrices",
      },
      {
        type: "item",
        key: "presets",
        id: "sys-presets",
        label: "admin.nav_presets",
      },
    ],
  },
  {
    type: "group",
    key: "systemIntegration",
    label: "admin.nav_systemIntegration",
    items: [
      {
        type: "item",
        key: "rolePositioning",
        id: "sys-role-positioning",
        label: "admin.nav_rolePositioning",
      },
      {
        type: "item",
        key: "segmentedPromptRule",
        id: "sys-segmented-prompt-rule",
        label: "admin.nav_segmentedPromptRule",
      },
      {
        type: "item",
        key: "aliyunOss",
        id: "sys-aliyun-oss",
        label: "admin.nav_aliyunOss",
      },
    ],
  },
];

export function flattenSystemNavEntries(
  entries: readonly SystemNavEntry[],
): SystemNavItem[] {
  return entries.flatMap((entry) => [...entry.items]);
}

export function getSystemScrollMarker(
  rootTop: number,
  rootHeight: number,
  windowScroller: boolean,
): number {
  const offset = windowScroller
    ? Math.min(320, Math.max(140, rootHeight * 0.38))
    : Math.min(96, Math.max(48, rootHeight * 0.08));
  return rootTop + offset;
}

export const SYSTEM_SETTING_SECTIONS = flattenSystemNavEntries(
  SYSTEM_SETTING_NAV_ENTRIES,
);

const HIDDEN_DESKTOP_SYSTEM_SECTIONS = new Set<SystemSectionKey>([
  "account", "tutorial", "notice", "errorGuide", "inspiration",
]);

export const DESKTOP_SYSTEM_SETTING_NAV_ENTRIES: readonly SystemNavEntry[] = [
  {
    type: "group",
    key: "general",
    label: "admin.nav_general",
    items: [
      { type: "item", key: "appearance", id: "sys-appearance", label: "admin.nav_appearance" },
      { type: "item", key: "hotkey", id: "sys-hotkey", label: "admin.nav_hotkey" },
      { type: "item", key: "language", id: "sys-language", label: "admin.nav_language" },
      { type: "item", key: "windowClose", id: "sys-window-close", label: "admin.nav_windowClose" },
    ],
  },
  ...SYSTEM_SETTING_NAV_ENTRIES.flatMap<SystemNavEntry>((group) => {
    const [first, ...rest] = group.items.filter((item) => !HIDDEN_DESKTOP_SYSTEM_SECTIONS.has(item.key));
    return first ? [{ ...group, items: [first, ...rest] }] : [];
  }),
];

export const VALID_DESKTOP_SYSTEM_SECTION_KEYS = new Set(
  flattenSystemNavEntries(DESKTOP_SYSTEM_SETTING_NAV_ENTRIES).map((section) => section.key),
);

export const VALID_SYSTEM_SECTION_KEYS = new Set<SystemSectionKey>(
  SYSTEM_SETTING_SECTIONS.map((section) => section.key),
);
