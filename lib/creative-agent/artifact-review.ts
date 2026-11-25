import { z } from "zod";

export const artifactReviewSchema = z
  .object({
    totalDuration: z.number().positive().max(7200),
    maxSegmentDuration: z.number().positive().max(7200).optional(),
    segments: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            start: z.number().nonnegative(),
            end: z.number().positive(),
            prompt: z.string().trim().min(1).max(20000),
            references: z.array(z.string().min(1).max(256)).max(16),
          })
          .strict(),
      )
      .min(1)
      .max(300),
  })
  .strict();

export function reviewCreativeArtifact(
  raw: unknown,
  availableNodeIds: string[],
) {
  const input = artifactReviewSchema.parse(raw);
  const issues: { segment: string; message: string }[] = [];
  const ids = new Set<string>();
  let previousEnd = 0;
  for (const segment of input.segments) {
    if (ids.has(segment.id))
      issues.push({ segment: segment.id, message: "段号重复" });
    ids.add(segment.id);
    if (Math.abs(segment.start - previousEnd) > 0.05)
      issues.push({ segment: segment.id, message: "全局时间轴存在空隙或重叠" });
    if (segment.end <= segment.start)
      issues.push({ segment: segment.id, message: "结束时间必须晚于开始时间" });
    if (
      input.maxSegmentDuration &&
      segment.end - segment.start > input.maxSegmentDuration + 0.05
    )
      issues.push({
        segment: segment.id,
        message: "超过本次指定的单段时长限制；模型能力仍需实时核实",
      });
    if (segment.references.some((id) => !availableNodeIds.includes(id)))
      issues.push({
        segment: segment.id,
        message: "引用包含当前画布不存在的节点",
      });
    previousEnd = segment.end;
  }
  if (Math.abs(previousEnd - input.totalDuration) > 0.05)
    issues.push({
      segment: "total",
      message: "时间轴结束位置与计划总时长不一致",
    });
  return {
    structuralPassed: issues.length === 0,
    issues,
    totalDuration: input.totalDuration,
    segmentCount: input.segments.length,
    coverage:
      "仅检查提交的时间轴、段号、正文非空及节点存在性；未检查对白语速、剧情、参考适用性、画面或音轨，未证明模型支持该时长。",
  };
}
