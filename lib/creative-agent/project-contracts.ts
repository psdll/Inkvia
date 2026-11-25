export const creativeStages = [
  "brief",
  "script",
  "assets",
  "storyboard",
  "generation",
  "review",
  "delivery",
] as const;
export type CreativeStage = (typeof creativeStages)[number];
export const creativeStageLabels: Record<CreativeStage, string> = {
  brief: "需求",
  script: "故事与剧本",
  assets: "资产与连续性",
  storyboard: "分镜与提示词",
  generation: "生成",
  review: "检查与采用",
  delivery: "交付",
};
export type CreativeArtifact = {
  id: string;
  nodeId: string;
  title: string;
  kind: string;
  semanticHash: string;
  text?: string;
  batchId?: string;
  outputId?: string;
  mediaId?: string;
  generationId?: number;
  status: "confirmed" | "adopted" | "revoked";
  dependencies: string[];
  recordedAt: string;
  recordedBy: number;
  reason?: string;
};
export type CreativeProject = {
  version: 1;
  revision: number;
  constraints: string[];
  artifacts: CreativeArtifact[];
  updatedAt: string | null;
};
export type CreativeProgress = {
  stage: CreativeStage;
  nextAction: string;
  questions: string[];
};
export type CreativeProjectSnapshot = {
  project: CreativeProject;
  progress: CreativeProgress;
  changes: { artifactId: string; title: string; reason: string }[];
  candidates: import("./contracts").CreativeAgentReference[];
};
