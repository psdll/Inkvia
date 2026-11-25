export type CreativeToolActivity = {
  category: "skill" | "tool"; operation: "catalog" | "read" | "prepared";
  skillId?: string; name?: string; revision?: number; path?: string; primaryPath?: string;
  selectionOrigin: "user" | "agent" | "unknown";
  origin: "input_expansion" | "tool_call" | "historical";
  purpose: string;
};
const short = (value: unknown, max = 240) => typeof value === "string" ? value.slice(0,max) : undefined;
/** Identity comes from authorized skill reads, never from its body or a display filename. */
export function creativeToolActivity(name: string, result: Record<string, unknown>, origin: CreativeToolActivity["origin"] = "tool_call"): CreativeToolActivity | undefined {
  if (name !== "skillOperator") return undefined;
  const old = result.activity && typeof result.activity === "object" ? result.activity as Record<string, unknown> : {};
  const operation = Array.isArray(result.skills) || result.action === "list" || old.operation === "catalog" ? "catalog" : origin === "input_expansion" || old.operation === "prepared" ? "prepared" : "read";
  const selectedOrigin = old.origin === "input_expansion" || origin === "input_expansion" ? "input_expansion" : old.origin === "historical" ? "historical" : "tool_call";
  const path = short(result.path ?? old.path, 300), primaryPath = short(result.primaryPath ?? old.primaryPath, 300);
  return { category:"skill", operation, ...(short(result.id ?? result.skillId ?? old.skillId) ? {skillId:short(result.id ?? result.skillId ?? old.skillId)} : {}), ...(short(result.name ?? old.name) ? {name:short(result.name ?? old.name)} : {}), ...(typeof (result.revision ?? old.revision) === "number" ? {revision:Number(result.revision ?? old.revision)} : {}), ...(path ? {path} : {}), ...(primaryPath ? {primaryPath} : {}), origin:selectedOrigin, selectionOrigin:selectedOrigin === "input_expansion" ? "user" : selectedOrigin === "historical" ? "unknown" : "agent", purpose: operation === "catalog" ? "查询当前可用技能" : operation === "prepared" ? "加载本轮所选技能" : path && primaryPath ? path === primaryPath ? "读取技能主文件" : "读取技能参考资料" : short(old.purpose) || "读取技能资料" };
}

/** Main-file identity comes from the authorized result, never a guessed filename. */
export function creativeSkillActivityLabel(activity: CreativeToolActivity, status: "running" | "completed" | "failed" = "completed"): string {
  const running = status === "running";
  if (activity.operation === "catalog") return running ? "正在查询可用技能" : "查询可用技能";
  if (activity.operation === "prepared") return `${running ? "正在加载技能" : status === "completed" ? "已加载技能" : "加载技能"}${activity.name ? ` · ${activity.name}` : ""}`;
  if (activity.primaryPath && activity.path === activity.primaryPath) return `${running ? "正在读取主文件" : "读取主文件"} · ${[activity.name, activity.path].filter(Boolean).join(" / ")}`;
  return `${running ? "正在读取技能资料" : "读取技能资料"}${activity.path || activity.name ? ` · ${activity.path || activity.name}` : ""}`;
}

/** Shared truthful failure labels for live events, refreshed cards and traces. */
export function creativeToolFailurePresentation(name: string, detail: Record<string, unknown>, failed = true): { title?: string; outcomeLabel: string } | undefined {
  if (detail.receiptState === "unknown") return { outcomeLabel: "结果待核实" };
  if (detail.status === "waiting") return { outcomeLabel: "等待确认" };
  if (detail.revisionRequested) return { outcomeLabel: "已要求修改" };
  if (detail.cancelled) return { outcomeLabel: "已取消" };
  if (detail.dispatchState === "partial") return { outcomeLabel: "部分已提交，后续准备未通过" };
  if (Number.isSafeInteger(detail.generationId) && Number(detail.generationId) > 0) {
    if (detail.status === "failed") return { outcomeLabel: "生成失败" };
    if (failed) return { outcomeLabel: "已提交，操作未完成" };
  }
  if (detail.phase === "preflight" && detail.dispatched === false) return { title: name === "image.generate" ? "准备图片生成" : name === "video.generate" ? "准备视频生成" : undefined, outcomeLabel: "未通过（未提交）" };
  if (failed || detail.status === "failed") return { outcomeLabel: "操作未完成" };
  return undefined;
}

/** Only presentation fields enter the event stream; complete results stay in tool receipts. */
export function creativeToolPresentation(
  name: string,
  result: Record<string, unknown>,
): Record<string, unknown> {
  const fields = [
    "status",
    "receiptState",
    "phase",
    "code",
    "dispatchState",
    "rejectedBeforeDispatch",
    "dispatched",
    "cancelled",
    "revisionRequested",
    "canUndo",
    "message",
    "error",
    "coverage",
    "title",
    "description",
    "structuralPassed",
    "issues",
    "decision",
    "generationId",
    "model",
    "mediaType",
    "outputs",
    "retryOfGenerationId",
    "retryAttempt",
    "retryReason",
  ];
  const detail = Object.fromEntries(
    fields
      .filter((key) => result[key] !== undefined)
      .map((key) => [key, result[key]]),
  );
  const successful = !result.error && !result.cancelled && !result.revisionRequested && result.receiptState !== "unknown"
    && (result.status === undefined || ["success", "succeeded", "completed"].includes(String(result.status)));
  if (successful && !detail.message) {
    const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    const plan = object(result.plan), requirements = object(result.requirements);
    if (name === "generation.plan" && Array.isArray(plan?.steps) && plan.steps.length
      && plan.steps.every(step => ["final", "intermediate"].includes(String(object(step)?.role)) && ["ready", "blocked", "unavailable"].includes(String(object(step)?.status)))) {
      const steps = plan.steps as { role: string; status: string }[];
      detail.message = `已准备 ${steps.length} 个步骤：最终产物 ${steps.filter(step => step.role === "final").length} 步，中间产物 ${steps.filter(step => step.role === "intermediate").length} 步；${steps.filter(step => step.status === "ready").length} 步就绪，${steps.filter(step => step.status === "blocked").length} 步等待依赖，${steps.filter(step => step.status === "unavailable").length} 步暂无可用方案。此工具仅准备方案，不会提交生成。`;
    } else if (name === "generation.requirements" && Array.isArray(requirements?.facts) && Array.isArray(requirements.conflicts)
      && requirements.facts.every(fact => typeof object(fact)?.field === "string") && requirements.conflicts.every(field => typeof field === "string")) {
      detail.message = `本轮需求记录涉及 ${new Set(requirements.facts.map(fact => object(fact)!.field)).size} 个字段，${requirements.conflicts.length} 项冲突待澄清；保存默认未改变，未授权生成。`;
    } else if (name === "generation.models" && Array.isArray(result.image) && Array.isArray(result.video)) {
      detail.message = `当前目录返回 ${result.image.length} 个图片条目、${result.video.length} 个视频条目，供选型与参数查询；不代表已调用这些模型。`;
    } else if (name === "model.guidance" && short(result.model) && short(result.title)) {
      detail.message = result.profileId === null ? `模型 ${short(result.model)}：${short(result.title)}；已返回通用写作参考。` : `已读取模型 ${short(result.model)} 的《${short(result.title)}》，用于提示词写作参考。`;
    } else if (name === "history.read" && Number.isSafeInteger(result.total) && Number(result.total) >= 0 && Array.isArray(result.matches) && result.matches.length <= Number(result.total)) {
      detail.message = `检索到 ${result.total} 条相关历史，本次返回 ${result.matches.length} 条。`;
    } else if (name === "project.progress" && typeof object(result.progress)?.stage === "string") {
      detail.message = "已更新本对话的创作进度，共享采用版本未改变。";
    } else if (["canvas.create", "canvas.patch", "canvas.focus"].includes(name) && Array.isArray(result.nodeIds) && result.nodeIds.length && result.nodeIds.every(id => typeof id === "string")
      && (name === "canvas.focus" ? result.focus === true : typeof result.revision === "string")) {
      detail.message = `已${name === "canvas.create" ? "创建" : name === "canvas.patch" ? "更新" : "定位"} ${result.nodeIds.length} 个画布节点。`;
    }
  }
  if (Array.isArray(result.generations)) detail.generations = result.generations.map(item => creativeToolPresentation("generation.read", item));
  if (name === "skillOperator") {
    const activity = creativeToolActivity(name,result)!;
    detail.activity = activity;
    detail.message = result.status === "error" || result.status === "failed" ? short(result.message) || "技能资料未能读取。" : activity.operation === "catalog"
      ? Array.isArray(result.skills) ? `已查询 ${result.skills.length} 个技能包。` : short(result.message) || "已查询可用技能。"
      : `${activity.operation === "prepared" ? "已加载" : "已读取"}${activity.name ? `《${activity.name}》` : "技能资料"}${activity.path ? ` · ${activity.path}` : ""}。`;
  }
  if (name === "canvas.read")
    detail.readCount = Array.isArray(result.nodes)
      ? result.nodes.length
      : result.readCount;
  if (
    name === "project.read" &&
    result.project &&
    typeof result.project === "object"
  ) {
    const project = result.project as {
      constraints?: unknown[];
      artifacts?: unknown[];
    };
    detail.message = `已读取 ${project.constraints?.length || 0} 条项目约定和 ${project.artifacts?.length || 0} 条版本记录。`;
  }
  return detail;
}
