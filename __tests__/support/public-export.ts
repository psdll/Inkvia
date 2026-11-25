import { existsSync } from "node:fs";

// The exporter itself is omitted from the public tree along with private fixtures.
export const isPublicExport = !existsSync("scripts/open-source/export.mjs");
