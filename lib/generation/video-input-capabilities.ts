import { getVideoModelSpec, getVideoReferenceLimits, isSeedance25VideoModel, isGeminiOmniVideoModel, isApimartVideoModel, isVolcengineVideoModel, APIMART_SEEDANCE_25_MODEL_ID } from "@/lib/sora2";
import { isMiniMaxH3VideoModel } from "@/lib/minimax-models";
import { isWanVideoModel } from "@/lib/wan-models";
import { validateWanMediaSet } from "@/lib/wan-media-policy";
import { getSeedanceMediaPolicy, validateSeedanceMediaSet } from "@/lib/seedance-media-policy";
import { validateMiniMaxH3MediaSet } from "@/lib/minimax-h3-media-policy";
import type { ResolvedGenerationInput } from "@/lib/tool-media/generation-inputs";
const cleanString = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** The execution transform is also applied before matching/approval, never after a signed hard requirement. */
export function normalizeVideoCombination<T extends { model?: string; inputMode?: string; ratio?: string; duration?: number; omniReferenceTaskType?: string }>(input: T, references: { kind: string }[]): T {
  if (isSeedance25VideoModel(input.model || "") && input.inputMode === "multimodal" && (cleanString(input.omniReferenceTaskType) || "auto") === "auto" && references.some(media => media.kind === "video")) {
    return { ...input, ratio: "adaptive", duration: -1, omniReferenceTaskType: "auto" };
  }
  return input;
}

export function validateVideoResolvedInputs(input: {
  model: string;
  inputMode: string;
  inputs: Array<Pick<
    ResolvedGenerationInput,
    "kind" | "position" | "localPath" | "mediaId" | "fileName" | "byteSize" | "probe"
  >>;
  ratio?: string;
  duration?: number;
  omniReferenceTaskType?: string;
  outputFormat?: string;
  cameraFixed?: boolean; seed?: number; watermark?: boolean;
}, rejectToolMedia: (message: string) => never = message => { throw new Error(message); }) {
  const isSeedance25 = isSeedance25VideoModel(input.model || "");
  const isMiniMaxH3 = isMiniMaxH3VideoModel(input.model);
  const taskType = cleanString(input.omniReferenceTaskType);
  const outputFormat = cleanString(input.outputFormat);

  const spec = getVideoModelSpec(input.model);
  if (input.cameraFixed && !isVolcengineVideoModel(input.model)) rejectToolMedia("当前实际执行路线不支持固定镜头");
  if (input.seed !== undefined && !isVolcengineVideoModel(input.model) && !isWanVideoModel(input.model)) rejectToolMedia("当前实际执行路线不支持随机种子");
  if (input.watermark && !isVolcengineVideoModel(input.model) && !isWanVideoModel(input.model) && !isMiniMaxH3 && input.model !== APIMART_SEEDANCE_25_MODEL_ID) rejectToolMedia("当前实际执行路线不支持水印开关");
  if (outputFormat && !spec.supportedOutputFormats?.includes(outputFormat as never)) rejectToolMedia("当前模型不支持此输出格式");
  if (taskType && !spec.supportedOmniReferenceTaskTypes?.includes(taskType as never)) rejectToolMedia("当前模型不支持此多模态任务类型");

  if (isSeedance25) {
    if (outputFormat && !["mp4", "mov"].includes(outputFormat)) {
      rejectToolMedia("Seedance 2.5 输出格式仅支持 mp4 或 mov");
    }
    if (taskType && !["auto", "edit", "extend"].includes(taskType)) {
      rejectToolMedia("Seedance 2.5 多模态任务类型仅支持 auto、edit 或 extend");
    }
    if (["first_frame", "first_last_frame"].includes(input.inputMode) && input.ratio !== "adaptive") {
      rejectToolMedia("Seedance 2.5 首帧/首尾帧生成必须使用自适应比例");
    }
    if (taskType && input.inputMode !== "multimodal") {
      rejectToolMedia("Seedance 2.5 多模态任务类型只能用于多模态参考模式");
    }
  }

  if (isMiniMaxH3) {
    const miniMaxLabel = getVideoModelSpec(input.model).label;
    const concreteRatios = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
    if (["first_frame", "first_last_frame"].includes(input.inputMode) && input.ratio !== "adaptive") {
      rejectToolMedia(`${miniMaxLabel} 首帧/首尾帧生成必须使用自适应比例`);
    }
    if (input.inputMode === "text_to_video" && !concreteRatios.includes(input.ratio || "")) {
      rejectToolMedia(`${miniMaxLabel} 文生视频必须选择明确画面比例`);
    }
    if (input.inputMode === "multimodal" && ![...concreteRatios, "adaptive"].includes(input.ratio || "")) {
      rejectToolMedia(`${miniMaxLabel} 多模态参考模式画面比例无效`);
    }
  }

  if (!input.inputs.length) {
    if (input.inputMode === "multimodal" && (isMiniMaxH3 || isWanVideoModel(input.model) || isApimartVideoModel(input.model) || isVolcengineVideoModel(input.model))) rejectToolMedia("多模态参考模式至少需要 1 个素材");
    return;
  }

  if (isWanVideoModel(input.model)) {
    if (input.inputs.some((media) => media.localPath.startsWith("/uploads/") && (!media.probe || media.byteSize === undefined))) {
      rejectToolMedia("素材尚未完成 Wan3.0 合规检测，请重新上传后重试");
    }
    const issues = validateWanMediaSet({ duration: input.duration, media: input.inputs.flatMap((media) =>
      media.probe && media.byteSize !== undefined ? [{ fileName: media.fileName, byteSize: media.byteSize, probe: media.probe }] : []),
    });
    if (issues.length) rejectToolMedia(issues[0].message);
  }

  const unsupported = input.inputs.find((media) => !["image", "video", "audio"].includes(media.kind));
  if (unsupported) rejectToolMedia(`不支持 ${unsupported.kind || "未知"} 类型的素材`);

  const seedancePolicy = getSeedanceMediaPolicy(input.model);
  if (seedancePolicy && process.env.SEEDANCE_MEDIA_VALIDATION_DISABLED !== "1") {
    const missingLocalProbe = input.inputs.find((media) =>
      cleanString(media.localPath).replaceAll("\\", "/").startsWith("/uploads/")
      && (!media.probe || media.byteSize === undefined),
    );
    if (missingLocalProbe) {
      rejectToolMedia(`${missingLocalProbe.fileName || "素材"} 尚未完成合规检测，请重新上传后重试`);
    }
    const issues = validateSeedanceMediaSet({
      modelId: input.model,
      taskType: taskType === "edit" || taskType === "extend" ? taskType : "auto",
      media: input.inputs.flatMap((media) =>
        media.probe && media.byteSize !== undefined
          ? [{
              mediaId: media.mediaId,
              fileName: media.fileName,
              byteSize: media.byteSize,
              probe: media.probe,
            }]
          : [],
      ),
    });
    if (issues.length > 0) {
      const issue = issues[0];
      rejectToolMedia(`${issue.fileName ? `${issue.fileName}：` : ""}${issue.message}`);
    }
  }

  if (isMiniMaxH3) {
    const missingLocalProbe = input.inputs.find((media) =>
      cleanString(media.localPath).replaceAll("\\", "/").startsWith("/uploads/")
      && (!media.probe || media.byteSize === undefined),
    );
    if (missingLocalProbe) {
      rejectToolMedia(`${missingLocalProbe.fileName || "素材"} 尚未完成 ${getVideoModelSpec(input.model).label} 合规检测，请重新上传后重试`);
    }
    const issues = validateMiniMaxH3MediaSet({
      modelId: input.model,
      media: input.inputs.flatMap((media) => media.probe && media.byteSize !== undefined
        ? [{
            mediaId: media.mediaId,
            fileName: media.fileName,
            byteSize: media.byteSize,
            probe: media.probe,
          }]
        : []),
    });
    if (issues.length > 0) {
      const issue = issues[0];
      rejectToolMedia(`${issue.fileName ? `${issue.fileName}：` : ""}${issue.message}`);
    }
  }

  if (input.inputMode === "text_to_video") {
    rejectToolMedia("文生视频模式不接受素材输入");
  }
  if (input.inputMode === "first_frame") {
    if (input.inputs.length !== 1) rejectToolMedia("首帧图模式必须且只能使用 1 张图片");
    if (input.inputs[0].kind !== "image") rejectToolMedia("首帧图模式只能使用图片素材");
    return;
  }
  if (input.inputMode === "first_last_frame") {
    if (input.inputs.length !== 2) rejectToolMedia("首尾帧模式必须且只能使用 2 张图片");
    if (input.inputs.some((media) => media.kind !== "image")) {
      rejectToolMedia("首尾帧模式只能使用图片素材");
    }
    return;
  }
  if (input.inputMode !== "multimodal") {
    rejectToolMedia("当前输入模式不接受素材");
  }

  if (isSeedance25 && (taskType === "edit" || taskType === "extend")) {
    if (!input.inputs.some((media) => media.kind === "video")) {
      rejectToolMedia(`Seedance 2.5 ${taskType === "edit" ? "编辑" : "续写"}至少需要 1 个参考视频`);
    }
    if (input.ratio !== "adaptive") {
      rejectToolMedia("Seedance 2.5 编辑/续写必须使用自适应比例");
    }
    if (taskType === "edit" && input.duration !== -1) {
      rejectToolMedia("Seedance 2.5 视频编辑必须使用自动时长");
    }
  }

  const referenceLimits = getVideoReferenceLimits(input.model);
  if (referenceLimits) {
    const imageCount = input.inputs.filter((media) => media.kind === "image").length;
    const videoCount = input.inputs.filter((media) => media.kind === "video").length;
    const audioCount = input.inputs.filter((media) => media.kind === "audio").length;
    if (imageCount > referenceLimits.images) rejectToolMedia(`该模型最多支持 ${referenceLimits.images} 张参考图片`);
    if (videoCount > referenceLimits.videos) rejectToolMedia(`该模型最多支持 ${referenceLimits.videos} 个参考视频`);
    if (audioCount > referenceLimits.audios) rejectToolMedia(`该模型最多支持 ${referenceLimits.audios} 个参考音频`);
    if (input.inputs.length > referenceLimits.total) rejectToolMedia(`该模型最多支持 ${referenceLimits.total} 个参考素材`);
    if (audioCount > 0 && !referenceLimits.standaloneAudio && imageCount + videoCount === 0) {
      rejectToolMedia("Seedance 2.0 参考音频必须与图片或视频素材一起使用");
    }
    return;
  }

  if (isGeminiOmniVideoModel(input.model)) {
    if (input.inputs.some((media) => media.kind === "audio")) {
      rejectToolMedia("Gemini 视频模型不支持音频素材");
    }
    const videoCount = input.inputs.filter((media) => media.kind === "video").length;
    if (videoCount > 1) rejectToolMedia("Gemini 视频模型最多只能使用 1 个视频素材");
    const imageCount = input.inputs.filter((media) => media.kind === "image").length;
    if (imageCount + videoCount * 2 > 7) {
      rejectToolMedia("参考素材超出配额：图片每张占 1 份、视频占 2 份，总和不能超过 7");
    }
    return;
  }

  if (isApimartVideoModel(input.model)) {
    const videoCount = input.inputs.filter((media) => media.kind === "video").length;
    const audioCount = input.inputs.filter((media) => media.kind === "audio").length;
    if (videoCount > 3) rejectToolMedia("该模型最多只能使用 3 个视频素材");
    if (audioCount > 3) rejectToolMedia("该模型最多只能使用 3 个音频素材");
    return;
  }

  if (isVolcengineVideoModel(input.model)) {
    if (input.inputs.length > 12) rejectToolMedia("最多支持 12 个素材文件");
    return;
  }

  rejectToolMedia("当前模型不支持多模态素材");
}
