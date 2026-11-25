import type { CanvasDocumentV2, CanvasNode } from "@/lib/canvas/document";
import type { CanvasImageTaskSettings } from "@/lib/canvas/image-task";
import { getCanvasTaskResultFrameSize } from "@/lib/canvas/task-references";
import { getCanvasConnectionDecision } from "@/lib/canvas/connection-rules";
import { CANVAS_LOCAL_UPLOAD_GAP, getCanvasLocalUploadPositions } from "@/lib/canvas/material-placement";
import { DEFAULT_CANVAS_MEDIA_NODE_SIZE } from "@/lib/canvas/media-size";
import { canvasNodeWorldPosition } from "@/lib/canvas/spatial-index";
import { fitCanvasGroupBounds } from "@/lib/canvas/group-layout";
import { CHARACTER_SHEET_TOKEN } from "@/lib/canvas/creative-presets/inline-token";

export const CANVAS_CHARACTER_SHEET_PROMPT = `根据当前上传的参考图，生成一张该人物的写实角色设定图，包含全身三视图和六张多角度头肩特写。

【参考图还原原则】
当前参考图是人物外观与穿着的唯一依据。所有视图必须呈现参考图中的同一个人、同一套服装和同一种造型。

准确保留人物的脸型、五官比例、年龄感、肤色、身材、发色、发型和发饰，不美化成另一张脸，不改变体型。

完整保留参考图中的服装，包括颜色、材质、款式、领口、肩带或袖型、腰线、衣长、裙长、下摆、背部结构及穿着方式。参考图穿什么，所有视图就穿什么，不替换、不重新设计、不增加搭配。

严格按照参考图保留足部状态：参考图赤脚，所有显示足部的视图都必须赤脚；参考图穿鞋，则保留原有鞋款。脚部被衣物遮挡时，保留原有遮挡关系，不缩短衣物以露出脚部，不擅自添加鞋袜。

首饰和配件仅保留参考图中已有的内容，不自行添加。充分利用参考图已有的正面、侧面和背面信息；未展示的部分只做与已知结构一致的必要补全，不引入新的设计。

【画面布局】
16:9横向画布，干净纯白背景，左侧约占一半宽度，右侧约占一半宽度。

左侧：并排排列正面、90度侧面、背面三张全身视图。人物比例与高度一致，头顶和脚底基本对齐，从头到脚完整展示，保留服装原本的完整长度与自然垂坠。自然站立，手臂放松，不遮挡服装关键结构。

右侧：两行三列，共六张头肩特写。
上排从左到右：正面自然表情、朝画面右侧的45度侧面、朝画面右侧的90度侧面。
下排从左到右：后脑与发型背面、朝画面左侧的45度侧面、正面轻微闭嘴微笑。
特写保留完整头顶、颈部、肩部和部分上胸，露出的衣领、肩带、首饰必须与全身视图和参考图一致。

【画面风格】
真实摄影质感，柔和均匀的棚拍光线，保留自然皮肤纹理、发丝与服装材质。各视图光线、色彩和人物身份一致。视图之间以适量白色留白分隔，不添加边框、网格线、文字、标签、水印或场景道具。

只改变观察角度、景别和排版，除指定的轻微表情变化外，保持参考人物原有外观与穿着。`;

export function buildCanvasCharacterSheetPrompt(supplement: string): string {
  return [CANVAS_CHARACTER_SHEET_PROMPT, supplement.replaceAll(CHARACTER_SHEET_TOKEN, "").trim()].filter(Boolean).join("\n\n");
}

export function createCanvasCharacterSheetTask(document: CanvasDocumentV2, input: {
  sourceId: string; url: string; settings: CanvasImageTaskSettings; nodeId: string; edgeId: string;
}): CanvasDocumentV2 {
  const source = document.nodes.find((node) => node.id === input.sourceId);
  const output = source?.data.kind === "imageTask"
    ? source.data.task.batches.flatMap((batch) => batch.outputs).find((item) => item.status === "success" && item.url === input.url)
    : undefined;
  if (!source || !input.url || input.url.startsWith("blob:")
    || !(source.data.kind === "image" && source.data.url === input.url || output)) {
    throw new Error("参考图尚未准备好，请完成上传或生成后再试。");
  }
  const data = { kind: "imageTask" as const, task: {
    references: [], batches: [], preset: "characterSheet" as const,
    pinnedSource: { sourceNodeId: source.id, url: input.url, mediaId: source.data.kind === "image" ? source.data.mediaId : output?.mediaId },
    settings: { ...input.settings, prompt: CHARACTER_SHEET_TOKEN, aspectRatio: "16:9" },
  } };
  const size = getCanvasTaskResultFrameSize(data);
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const sourcePosition = canvasNodeWorldPosition(source, byId);
  const ancestors = new Set<string>();
  for (let parentId = source.parentId; parentId && !ancestors.has(parentId); parentId = byId.get(parentId)?.parentId) ancestors.add(parentId);
  const occupied = document.nodes.map((node) => ({
    ...node, position: canvasNodeWorldPosition(node, byId), parentId: undefined,
  })).filter((node) => !ancestors.has(node.id));
  const [position] = getCanvasLocalUploadPositions([size], {
    x: sourcePosition.x + (source.width ?? DEFAULT_CANVAS_MEDIA_NODE_SIZE.width) + CANVAS_LOCAL_UPLOAD_GAP,
    y: sourcePosition.y,
  }, occupied);
  const node: CanvasNode = { id: input.nodeId, type: "imageTask", parentId: source.parentId,
    position: { x: position.x - (sourcePosition.x - source.position.x), y: position.y - (sourcePosition.y - source.position.y) }, data, ...size };
  const nodes = source.parentId ? fitCanvasGroupBounds([...document.nodes, node], [source.parentId], true) : [...document.nodes, node];
  const decision = getCanvasConnectionDecision(nodes, { source: source.id, target: node.id }, document.edges);
  if (!decision.allowed) throw new Error(decision.error || "无法连接参考图。");
  return { ...document, nodes, edges: [...document.edges, { id: input.edgeId, source: source.id, target: node.id, type: "default" }] };
}
