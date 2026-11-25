export function generationOutputPaths(row: { localPath?: string | null; templateData?: unknown }): string[] {
  let meta: any = row.templateData;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
  const saved = Array.isArray(meta?.savedOutputs) ? [...meta.savedOutputs].sort((a: any, b: any) => Number(a.outputIndex) - Number(b.outputIndex)).map((s: any) => s.localPath) : [];
  const paths = Array.isArray(meta?.outputPaths) ? meta.outputPaths : Array.isArray(meta?.outputLocalPaths) ? meta.outputLocalPaths : [];
  return [...new Set([row.localPath, ...saved, ...paths, meta?.lastFramePath].filter((s): s is string => typeof s === 'string' && s.startsWith('/uploads/')))];
}

