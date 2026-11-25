export const PAGE_REVEAL_STRATEGIES = {
  "app/(home)/page.tsx": "home-client-ready",
  "app/admin/page.tsx": "admin-shell-with-panel-loading",
  "app/admin/activity/page.tsx": "admin-account-gated-panel",
  "app/admin/material-assets/page.tsx": "material-assets-first-load",
  "app/admin/materials/page.tsx": "admin-materials-first-load",
  "app/admin/role-skills/editor/page.tsx": "role-skill-editor-load",
  "app/batch-workbench/page.tsx": "selected-workbench-bootstrap",
  "app/canvas/page.tsx": "canvas-list-bootstrap",
  "app/canvas/[id]/page.tsx": "canvas-document-bootstrap",
  "app/image/page.tsx": "image-workspace-bootstrap",
  "app/material-inspirations/page.tsx": "inspiration-first-load",
  "app/materials/page.tsx": "materials-first-load",
  "app/materials/upload/page.tsx": "material-upload-permission-gate",
  "app/settings/page.tsx": "settings-independent-panels",
  "app/studio/page.tsx": "studio-tool-bootstrap",
  "app/video/page.tsx": "video-workspace-bootstrap",
  "app/works/page.tsx": "works-first-load",
  "app/usage/page.tsx": "redirect-to-settings-usage",
} as const;

export type PageRevealRoute = keyof typeof PAGE_REVEAL_STRATEGIES;
