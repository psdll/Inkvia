"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import type { fabric as FabricTypes } from "fabric";
import { X, Crop, Grid3x3, Brush, Loader2, Eye, Square, Circle, ListOrdered, Type, Undo2, Redo2, MoveUpRight, Minus, ArrowRight, ArrowLeft, MoveHorizontal } from "lucide-react";
import Portal from "./Portal";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { uploadCanvasMedia } from "@/lib/canvas/media-upload-client";
import type { CanvasMediaIdentity } from "@/lib/canvas/document";
import {
  updateCropRect,
  type CropInteraction,
  type CropRect,
} from "@/lib/canvas/crop-rect";

type Mode = "preview" | "crop" | "brush" | "mask" | "outpaint" | "grid";
type BrushTool = "free" | "arrow" | "mosaic" | "rect" | "ellipse" | "label" | "text";
type ArrowHeadStyle = "none" | "end" | "start" | "both";
type ArrowLineStyle = "solid" | "dashed" | "dotted";
type MosaicMode = "brush" | "rect" | "ellipse";
type MosaicStyle = "pixel" | "blur" | "portrait-blocks" | "sticker";
type CanvasPoint = { x: number; y: number };
type FabricEditorObject = FabricTypes.Object & { editorKind?: "sticker" };
type TextStyle = {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
};
type DrawingSnapshot = {
  raster: ImageData;
  textJson: object | null;
  labelSequence: number;
};
type MosaicSession = {
  snapshot: ImageData;
  pixelated: HTMLCanvasElement;
  start: CanvasPoint;
  last: CanvasPoint;
  didDraw: boolean;
};
type GridLine = { type: "h" | "v"; pos: number };
type GridRect = { row: number; col: number; x: number; y: number; w: number; h: number };
type OutpaintEdge = "top" | "right" | "bottom" | "left";
type OutpaintPadding = Record<OutpaintEdge, number>;
type CropDrag = {
  interaction: "create" | CropInteraction;
  startX: number;
  startY: number;
  startCrop: CropRect;
};
type OutpaintDrag = {
  edge: OutpaintEdge;
  startClientX: number;
  startClientY: number;
  startPad: OutpaintPadding;
  imageWidth: number;
  imageHeight: number;
};
type OutpaintPanDrag = {
  startClientX: number;
  startClientY: number;
  startPan: { x: number; y: number };
};
type ImageSize = { width: number; height: number };
type Props = {
  imageUrl: string;
  onClose: () => void;
  onResult: (urls: string[], mode: Mode, sourceFile?: File, sourceSize?: ImageSize, media?: CanvasMediaIdentity[]) => void | Promise<void>;
  initialMode?: Mode;
  onFilesResult?: (files: File[], mode: Mode) => void | Promise<void>;
};

const GRID_PRESETS = [
  [1, 2],
  [2, 1],
  [2, 2],
  [2, 3],
  [3, 2],
  [3, 3],
] as const;
const IMAGE_EDITOR_ZOOM_MAX = 10;
const IMAGE_EDITOR_HISTORY_LIMIT = 50;
const BRUSH_ZOOM_MIN = 0.01;
const BRUSH_SIZE_MIN = 1;
const BRUSH_SIZE_MAX = 120;
const BRUSH_SIZE_STEP = 2;
const MOSAIC_BLOCK_MIN = 2;
const MOSAIC_BLOCK_MAX = 40;
const MOSAIC_BLOCK_DEFAULT = 10;
const MOSAIC_STICKERS = ["😎", "🙈", "🤐", "😂", "🥸", "😷", "🤡", "👽"] as const;
const ARROW_WIDTH_PRESETS = [1, 2, 4, 8] as const;
const ARROW_COLORS = [
  "#111827", "#6b7280", "#ffffff", "#ef4444", "#f97316", "#facc15",
  "#22c55e", "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#ec4899",
] as const;
const TEXT_COLORS = [
  "#111111", "#4b5563", "#9ca3af", "#ffffff", "#ef4444", "#f97316", "#facc15", "#22c55e", "#06b6d4", "#3b82f6",
  "#7f1d1d", "#92400e", "#854d0e", "#166534", "#155e75", "#1e40af", "#6366f1", "#7e22ce", "#be185d", "#ec4899",
] as const;
const TEXT_FONT_OPTIONS = [
  { value: "Microsoft YaHei", label: "微软雅黑" },
  { value: "SimSun", label: "宋体" },
  { value: "SimHei", label: "黑体" },
  { value: "KaiTi", label: "楷体" },
  { value: "Arial", label: "Arial" },
  { value: "Helvetica", label: "Helvetica" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Georgia", label: "Georgia" },
  { value: "Rockwell", label: "Rockwell" },
];
const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "Microsoft YaHei",
  fontSize: 60,
  bold: false,
  italic: false,
  underline: false,
  color: "#ff3b30",
};

const MODES: { id: Mode; label: string; icon: React.ReactNode }[] = [
  { id: "preview", label: "预览", icon: <Eye className="h-3.5 w-3.5" /> },
  { id: "crop", label: "裁剪", icon: <Crop className="h-3.5 w-3.5" /> },
  { id: "brush", label: "画笔", icon: <Brush className="h-3.5 w-3.5" /> },
  { id: "grid", label: "宫格切分", icon: <Grid3x3 className="h-3.5 w-3.5" /> },
];

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function isTextEntryTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  if (element.isContentEditable || element.closest("textarea, [contenteditable='true']")) return true;
  const input = element.closest("input");
  return input instanceof HTMLInputElement
    && ["text", "search", "email", "url", "tel", "password", "number", "color"].includes(input.type);
}

function isFabricTextObject(object: FabricTypes.Object | null | undefined): object is FabricTypes.IText {
  return object?.type === "i-text";
}

function isFabricStickerObject(
  object: FabricTypes.Object | null | undefined,
): object is FabricEditorObject {
  return (object as FabricEditorObject | null | undefined)?.editorKind === "sticker";
}

const TEXT_CONTROL_DELETE_EVENT = "editor:text-delete";
const TEXT_CONTROL_VISUAL_SIZE = 36;
const TEXT_CONTROL_HIT_SIZE = 64;
const TEXT_CONTROL_ROTATE_OFFSET = 56;
const TEXT_CONTROL_ROTATE_CURSOR = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36'%3E%3Ccircle cx='18' cy='18' r='16' fill='%233b82f6' stroke='%23fff' stroke-width='2'/%3E%3Ctext x='18' y='23' text-anchor='middle' font-family='Arial,sans-serif' font-size='22' font-weight='700' fill='%23fff'%3E%E2%86%BB%3C/text%3E%3C/svg%3E\") 18 18, grab";
type TextControlIcon = "scale-nwse" | "scale-nesw" | "rotate" | "delete";

function renderTextControlIcon(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  icon: TextControlIcon,
) {
  const half = TEXT_CONTROL_VISUAL_SIZE / 2;
  const radius = 6;
  const glyph = 8;
  ctx.save();
  ctx.translate(left, top);
  ctx.beginPath();
  if (icon === "rotate") {
    ctx.arc(0, 0, half, 0, Math.PI * 2);
  } else {
    ctx.moveTo(-half + radius, -half);
    ctx.lineTo(half - radius, -half);
    ctx.quadraticCurveTo(half, -half, half, -half + radius);
    ctx.lineTo(half, half - radius);
    ctx.quadraticCurveTo(half, half, half - radius, half);
    ctx.lineTo(-half + radius, half);
    ctx.quadraticCurveTo(-half, half, -half, half - radius);
    ctx.lineTo(-half, -half + radius);
    ctx.quadraticCurveTo(-half, -half, -half + radius, -half);
    ctx.closePath();
  }
  ctx.fillStyle = "#3b82f6";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  if (icon === "rotate") {
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("↻", 0, 1);
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (icon === "delete") {
    ctx.moveTo(-glyph, -glyph);
    ctx.lineTo(glyph, glyph);
    ctx.moveTo(glyph, -glyph);
    ctx.lineTo(-glyph, glyph);
  } else {
    const direction = icon === "scale-nwse" ? 1 : -1;
    ctx.moveTo(-glyph, -glyph * direction);
    ctx.lineTo(glyph, glyph * direction);
    ctx.moveTo(-glyph, -glyph * direction);
    ctx.lineTo(-glyph, -3 * direction);
    ctx.moveTo(-glyph, -glyph * direction);
    ctx.lineTo(-3, -glyph * direction);
    ctx.moveTo(glyph, glyph * direction);
    ctx.lineTo(glyph, 3 * direction);
    ctx.moveTo(glyph, glyph * direction);
    ctx.lineTo(3, glyph * direction);
  }

  ctx.stroke();
  ctx.restore();
}

const renderTextScaleNwse: FabricTypes.Control["render"] = (ctx, left, top) => {
  renderTextControlIcon(ctx, left, top, "scale-nwse");
};
const renderTextScaleNesw: FabricTypes.Control["render"] = (ctx, left, top) => {
  renderTextControlIcon(ctx, left, top, "scale-nesw");
};
const renderTextRotationControl: FabricTypes.Control["render"] = (ctx, left, top) => {
  renderTextControlIcon(ctx, left, top, "rotate");
};
const renderTextDeleteControl: FabricTypes.Control["render"] = (ctx, left, top) => {
  renderTextControlIcon(ctx, left, top, "delete");
};

function requestTextControlDelete(
  _eventData: MouseEvent,
  transform: FabricTypes.Transform,
) {
  transform.target.canvas?.fire(TEXT_CONTROL_DELETE_EVENT, { target: transform.target });
  return true;
}

function renderStickerScaleControl(direction: 1 | -1): FabricTypes.Control["render"] {
  return (ctx, left, top, _styleOverride, fabricObject) => {
    ctx.save();
    ctx.translate(left, top);
    ctx.rotate(((fabricObject.angle || 0) * Math.PI) / 180 + direction * Math.PI / 4);
    ctx.fillStyle = "#3b82f6";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-9, -9, 18, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("↔", 0, 0);
    ctx.restore();
  };
}

function renderStickerRotationControl(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
) {
  ctx.save();
  ctx.translate(left, top);
  ctx.fillStyle = "#3b82f6";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("↻", 0, 0);
  ctx.restore();
}

function cloneFabricControl(
  control: FabricTypes.Control,
  render: FabricTypes.Control["render"],
  size: number,
  overrides: Partial<FabricTypes.Control> = {},
) {
  const clone = Object.assign(
    Object.create(Object.getPrototypeOf(control)),
    control,
    overrides,
  ) as FabricTypes.Control;
  clone.render = render;
  clone.sizeX = size;
  clone.sizeY = size;
  clone.touchSizeX = Math.max(size, 28);
  clone.touchSizeY = Math.max(size, 28);
  return clone;
}

function configureFabricTextObject(object: FabricTypes.Object) {
  if (!isFabricTextObject(object)) return;
  object.initDimensions();
  const controls = { ...object.controls };
  if (controls.tl) controls.tl = cloneFabricControl(controls.tl, renderTextScaleNwse, TEXT_CONTROL_HIT_SIZE);
  if (controls.tr) {
    controls.tr = cloneFabricControl(
      controls.tr,
      renderTextDeleteControl,
      TEXT_CONTROL_HIT_SIZE,
      {
        actionName: "delete",
        withConnection: false,
        actionHandler: () => false,
        mouseUpHandler: requestTextControlDelete,
        cursorStyleHandler: () => "pointer",
      },
    );
  }
  if (controls.bl) controls.bl = cloneFabricControl(controls.bl, renderTextScaleNesw, TEXT_CONTROL_HIT_SIZE);
  if (controls.br) controls.br = cloneFabricControl(controls.br, renderTextScaleNwse, TEXT_CONTROL_HIT_SIZE);
  if (controls.mtr) {
    controls.mtr = cloneFabricControl(controls.mtr, renderTextRotationControl, TEXT_CONTROL_HIT_SIZE, {
      offsetY: -TEXT_CONTROL_ROTATE_OFFSET,
      withConnection: true,
      cursorStyleHandler: () => TEXT_CONTROL_ROTATE_CURSOR,
    });
  }
  object.controls = controls;
  object.set({
    transparentCorners: false,
    cornerColor: "#3b82f6",
    cornerStrokeColor: "#ffffff",
    cornerStyle: "rect",
    cornerSize: TEXT_CONTROL_VISUAL_SIZE,
    borderScaleFactor: 2,
    rotatingPointOffset: TEXT_CONTROL_ROTATE_OFFSET,
    borderColor: "#ffffff",
    editingBorderColor: "#ffffff",
    selectionColor: "rgba(0, 0, 0, 0)",
    padding: 8,
    lockMovementX: false,
    lockMovementY: false,
    hoverCursor: "move",
  });
  object.setControlsVisibility({
    tl: true,
    tr: true,
    bl: true,
    br: true,
    mtr: true,
    mt: false,
    mb: false,
    ml: false,
    mr: false,
  });
  object.setCoords();
}

function setTextControlsVisible(object: FabricTypes.Object, visible: boolean) {
  if (!isFabricTextObject(object)) return;
  object.set({ hasControls: visible, hasBorders: visible });
  object.setCoords();
  object.canvas?.requestRenderAll();
}

function setTextEditingFrameVisible(object: FabricTypes.Object) {
  if (!isFabricTextObject(object)) return;
  object.set({ hasControls: false, hasBorders: true, borderColor: "#ffffff" });
  object.setCoords();
  object.canvas?.requestRenderAll();
}

function configureFabricStickerObject(object: FabricTypes.Object) {
  if (!isFabricStickerObject(object)) return;
  const controls = { ...object.controls };
  if (controls.tl) controls.tl = cloneFabricControl(controls.tl, renderStickerScaleControl(1), 18);
  if (controls.tr) controls.tr = cloneFabricControl(controls.tr, renderStickerScaleControl(-1), 18);
  if (controls.bl) controls.bl = cloneFabricControl(controls.bl, renderStickerScaleControl(-1), 18);
  if (controls.br) controls.br = cloneFabricControl(controls.br, renderStickerScaleControl(1), 18);
  if (controls.mtr) controls.mtr = cloneFabricControl(controls.mtr, renderStickerRotationControl, 24);
  object.controls = controls;
  object.set({
    transparentCorners: false,
    cornerColor: "#3b82f6",
    cornerStrokeColor: "#ffffff",
    cornerStyle: "rect",
    cornerSize: 10,
    borderColor: "#ffffff",
    rotatingPointOffset: 28,
    lockRotation: false,
    lockScalingFlip: true,
    minScaleLimit: 0.15,
  });
  object.setControlsVisibility({
    mt: false,
    mb: false,
    ml: false,
    mr: false,
    mtr: true,
  });
  object.setCoords();
}

function configureFabricEditorObject(object: FabricTypes.Object) {
  configureFabricTextObject(object);
  configureFabricStickerObject(object);
}

function MosaicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="currentColor" d="M3 3h8v8H3zM13 13h8v8h-8z" />
      <path fill="currentColor" opacity=".35" d="M13 3h8v8h-8zM3 13h8v8H3z" />
    </svg>
  );
}

function createPrivacyComposite(
  image: HTMLImageElement,
  overlay: HTMLCanvasElement,
) {
  const width = overlay.width;
  const height = overlay.height;
  if (width < 1 || height < 1) return null;

  const composite = document.createElement("canvas");
  composite.width = width;
  composite.height = height;
  const compositeContext = composite.getContext("2d");
  if (!compositeContext) return null;
  compositeContext.drawImage(image, 0, 0, width, height);
  compositeContext.drawImage(overlay, 0, 0);
  return composite;
}

function createPrivacyEffectCanvas(
  image: HTMLImageElement,
  overlay: HTMLCanvasElement,
  style: Exclude<MosaicStyle, "sticker">,
  intensity: number,
) {
  const composite = createPrivacyComposite(image, overlay);
  if (!composite) return null;
  const width = composite.width;
  const height = composite.height;
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d");
  if (!outputContext) return null;

  if (style === "blur") {
    outputContext.filter = `blur(${Math.max(2, intensity)}px)`;
    outputContext.drawImage(composite, 0, 0);
    outputContext.filter = "none";
    return output;
  }

  const blockSize = style === "portrait-blocks"
    ? Math.max(4, intensity * 2)
    : intensity;
  const reduced = document.createElement("canvas");
  reduced.width = Math.max(1, Math.ceil(width / blockSize));
  reduced.height = Math.max(1, Math.ceil(height / blockSize));
  const reducedContext = reduced.getContext("2d");
  if (!reducedContext) return null;
  reducedContext.drawImage(composite, 0, 0, reduced.width, reduced.height);

  if (style === "portrait-blocks") {
    const imageData = reducedContext.getImageData(0, 0, reduced.width, reduced.height);
    for (let index = 0; index < imageData.data.length; index += 4) {
      imageData.data[index] = Math.round(imageData.data[index] / 32) * 32;
      imageData.data[index + 1] = Math.round(imageData.data[index + 1] / 32) * 32;
      imageData.data[index + 2] = Math.round(imageData.data[index + 2] / 32) * 32;
    }
    reducedContext.putImageData(imageData, 0, 0);
  }

  outputContext.imageSmoothingEnabled = false;
  outputContext.drawImage(reduced, 0, 0, width, height);
  return output;
}

function paintMosaicBrush(
  ctx: CanvasRenderingContext2D,
  pixelated: HTMLCanvasElement,
  from: CanvasPoint,
  to: CanvasPoint,
  diameter: number,
) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, diameter / 4)));
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const x = from.x + (to.x - from.x) * ratio;
    const y = from.y + (to.y - from.y) * ratio;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, diameter / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(pixelated, 0, 0);
    ctx.restore();
  }
}

function paintMosaicShape(
  ctx: CanvasRenderingContext2D,
  session: MosaicSession,
  end: CanvasPoint,
  mode: Exclude<MosaicMode, "brush">,
) {
  const x = Math.min(session.start.x, end.x);
  const y = Math.min(session.start.y, end.y);
  const width = Math.abs(end.x - session.start.x);
  const height = Math.abs(end.y - session.start.y);
  ctx.putImageData(session.snapshot, 0, 0);
  if (width < 1 || height < 1) return false;
  ctx.save();
  ctx.beginPath();
  if (mode === "rect") {
    ctx.rect(x, y, width, height);
  } else {
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  }
  ctx.clip();
  ctx.drawImage(session.pixelated, 0, 0);
  ctx.restore();
  return true;
}

function drawCanvasArrow(
  ctx: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  headStyle: ArrowHeadStyle,
  lineStyle: ArrowLineStyle,
  lineWidth: number,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return;

  const angle = Math.atan2(dy, dx);
  const dashUnit = Math.max(3, lineWidth * 2);
  const headLength = Math.max(4, Math.min(Math.max(10, lineWidth * 4), length * 0.45));
  const headHalfWidth = headLength * 0.55;
  const unitX = dx / length;
  const unitY = dy / length;
  const hasStartHead = headStyle === "start" || headStyle === "both";
  const hasEndHead = headStyle === "end" || headStyle === "both";
  const shaftStart = hasStartHead
    ? { x: start.x + unitX * headLength, y: start.y + unitY * headLength }
    : start;
  const shaftEnd = hasEndHead
    ? { x: end.x - unitX * headLength, y: end.y - unitY * headLength }
    : end;
  const drawHead = (tip: { x: number; y: number }, direction: number) => {
    const baseX = tip.x - Math.cos(direction) * headLength;
    const baseY = tip.y - Math.sin(direction) * headLength;
    const offsetX = Math.sin(direction) * headHalfWidth;
    const offsetY = -Math.cos(direction) * headHalfWidth;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(baseX + offsetX, baseY + offsetY);
    ctx.lineTo(baseX - offsetX, baseY - offsetY);
    ctx.closePath();
    ctx.fill();
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(
    lineStyle === "dashed"
      ? [dashUnit * 2, dashUnit]
      : lineStyle === "dotted"
        ? [Math.max(1, lineWidth), dashUnit]
        : [],
  );
  ctx.beginPath();
  ctx.moveTo(shaftStart.x, shaftStart.y);
  ctx.lineTo(shaftEnd.x, shaftEnd.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = ctx.strokeStyle;
  if (hasEndHead) drawHead(end, angle);
  if (hasStartHead) drawHead(start, angle + Math.PI);
  ctx.restore();
}

function uniqueSorted(values: number[]) {
  return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))].sort((a, b) => a - b);
}

function buildGridRects(width: number, height: number, hLines: number, vLines: number, gap: number, customLines: GridLine[] = []): GridRect[] {
  const safeGap = clampNumber(gap, 0, 240);
  const halfGap = safeGap / 2;
  const rects: GridRect[] = [];
  if (customLines.length) {
    const hCuts = [0, ...uniqueSorted(customLines.filter((line) => line.type === "h").map((line) => line.pos * height)), height];
    const vCuts = [0, ...uniqueSorted(customLines.filter((line) => line.type === "v").map((line) => line.pos * width)), width];
    for (let row = 0; row < hCuts.length - 1; row++) {
      for (let col = 0; col < vCuts.length - 1; col++) {
        const y1 = Math.round(row === 0 ? hCuts[row] : hCuts[row] + halfGap);
        const y2 = Math.round(row === hCuts.length - 2 ? hCuts[row + 1] : hCuts[row + 1] - halfGap);
        const x1 = Math.round(col === 0 ? vCuts[col] : vCuts[col] + halfGap);
        const x2 = Math.round(col === vCuts.length - 2 ? vCuts[col + 1] : vCuts[col + 1] - halfGap);
        if (x2 > x1 && y2 > y1) rects.push({ row, col, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      }
    }
    return rects;
  }

  const rows = clampNumber(Math.round(hLines), 0, 20) + 1;
  const cols = clampNumber(Math.round(vLines), 0, 20) + 1;
  for (let row = 0; row < rows; row++) {
    const topLine = (row * height) / rows;
    const bottomLine = ((row + 1) * height) / rows;
    const y1 = Math.round(row === 0 ? 0 : topLine + halfGap);
    const y2 = Math.round(row === rows - 1 ? height : bottomLine - halfGap);
    for (let col = 0; col < cols; col++) {
      const leftLine = (col * width) / cols;
      const rightLine = ((col + 1) * width) / cols;
      const x1 = Math.round(col === 0 ? 0 : leftLine + halfGap);
      const x2 = Math.round(col === cols - 1 ? width : rightLine - halfGap);
      if (x2 > x1 && y2 > y1) rects.push({ row, col, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
  }
  return rects;
}

async function uploadBlob(blob: Blob, name: string, size: ImageSize): Promise<CanvasMediaIdentity & { url: string }> {
  const result = await uploadCanvasMedia(new File([blob], name, { type: blob.type || "image/png" }));
  return { url: result.url, mediaId: result.mediaId, variants: { ...result.variants,
    original: { ...result.variants?.original, url: result.url, width: size.width, height: size.height } } };
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("导出失败"))), "image/png"));
}

export default function ImageEditorModal({ imageUrl, onClose, onResult, initialMode, onFilesResult }: Props) {
  const { text, label: uiLabel, error: uiError } = useUiLocale();
  const [mode, setMode] = React.useState<Mode>(initialMode ?? "crop");
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const boxRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const imageRef = React.useRef<HTMLImageElement>(null);

  const [crop, setCrop] = React.useState<CropRect>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const cropDrag = React.useRef<CropDrag | null>(null);

  const [hLines, setHLines] = React.useState(2);
  const [vLines, setVLines] = React.useState(2);
  const [gridGap, setGridGap] = React.useState(0);
  const [gridCustomMode, setGridCustomMode] = React.useState(false);
  const [gridCustomLines, setGridCustomLines] = React.useState<GridLine[]>([]);
  const [gridCustomOrientation, setGridCustomOrientation] = React.useState<"h" | "v">("h");
  const [gridCustomHistory, setGridCustomHistory] = React.useState<GridLine[][]>([]);
  const gridCustomDrag = React.useRef<{ index: number; pointerId: number } | null>(null);

  const [brushSize, setBrushSize] = React.useState(28);
  const [brushColor, setBrushColor] = React.useState("#ff3b30");
  const [brushTool, setBrushTool] = React.useState<BrushTool>("free");
  const [textStyle, setTextStyle] = React.useState<TextStyle>(DEFAULT_TEXT_STYLE);
  const textStyleRef = React.useRef<TextStyle>(DEFAULT_TEXT_STYLE);
  const brushToolRef = React.useRef<BrushTool>("free");
  const mosaicStyleRef = React.useRef<MosaicStyle>("pixel");
  const textCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = React.useRef<FabricTypes.Canvas | null>(null);
  const [selectedTextObject, setSelectedTextObject] = React.useState<FabricTypes.IText | null>(null);
  const [selectedStickerObject, setSelectedStickerObject] = React.useState<FabricTypes.Object | null>(null);
  const [selectedSticker, setSelectedSticker] = React.useState<(typeof MOSAIC_STICKERS)[number]>("😎");
  const selectedStickerRef = React.useRef<(typeof MOSAIC_STICKERS)[number]>("😎");
  const [textEditing, setTextEditing] = React.useState(false);
  const restoringDrawingRef = React.useRef(false);
  const transformSnapshotRef = React.useRef<DrawingSnapshot | null>(null);
  const textEditSnapshotRef = React.useRef<DrawingSnapshot | null>(null);
  const textEditHistoryRecordedRef = React.useRef(false);
  const skipNextTextEditHistoryRef = React.useRef(false);
  const [arrowHeadStyle, setArrowHeadStyle] = React.useState<ArrowHeadStyle>("end");
  const [arrowLineStyle, setArrowLineStyle] = React.useState<ArrowLineStyle>("solid");
  const [arrowOptionsOpen, setArrowOptionsOpen] = React.useState(false);
  const [mosaicMode, setMosaicMode] = React.useState<MosaicMode>("brush");
  const [mosaicStyle, setMosaicStyle] = React.useState<MosaicStyle>("pixel");
  const [mosaicBlockSize, setMosaicBlockSize] = React.useState(MOSAIC_BLOCK_DEFAULT);
  const [mosaicOptionsOpen, setMosaicOptionsOpen] = React.useState(false);
  const [brushZoom, setBrushZoom] = React.useState(1);
  const [brushPan, setBrushPan] = React.useState({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = React.useState(false);
  const spacePressedRef = React.useRef(false);
  const [brushPanning, setBrushPanning] = React.useState(false);
  const brushPanDrag = React.useRef<{ startClientX: number; startClientY: number; startPan: { x: number; y: number } } | null>(null);
  const drawRef = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const shapeStart = React.useRef<{ x: number; y: number; snapshot: ImageData } | null>(null);
  const mosaicSession = React.useRef<MosaicSession | null>(null);
  const drawingHistory = React.useRef<DrawingSnapshot[]>([]);
  const drawingFuture = React.useRef<DrawingSnapshot[]>([]);
  const [, refreshDrawingHistory] = React.useReducer((value: number) => value + 1, 0);
  const labelSequence = React.useRef(1);

  const [pad, setPad] = React.useState<OutpaintPadding>({ top: 0, right: 0, bottom: 0, left: 0 });
  const outpaintDrag = React.useRef<OutpaintDrag | null>(null);
  const outpaintPanDrag = React.useRef<OutpaintPanDrag | null>(null);
  const [stageSize, setStageSize] = React.useState({ width: 840, height: 440 });
  const [outpaintZoom, setOutpaintZoom] = React.useState(1);
  const [outpaintPan, setOutpaintPan] = React.useState({ x: 0, y: 0 });

  const captureDrawingSnapshot = React.useCallback((): DrawingSnapshot | null => {
    const cv = drawRef.current;
    if (!cv || cv.width < 1 || cv.height < 1) return null;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const fabricCanvas = fabricCanvasRef.current;
    return {
      raster: ctx.getImageData(0, 0, cv.width, cv.height),
      textJson: fabricCanvas ? fabricCanvas.toJSON(["editorKind"]) as object : null,
      labelSequence: labelSequence.current,
    };
  }, []);

  const pushDrawingHistory = React.useCallback((snapshot: DrawingSnapshot) => {
    drawingHistory.current.push(snapshot);
    if (drawingHistory.current.length > IMAGE_EDITOR_HISTORY_LIMIT) {
      drawingHistory.current.splice(0, drawingHistory.current.length - IMAGE_EDITOR_HISTORY_LIMIT);
    }
  }, []);

  const commitDrawingSnapshot = React.useCallback((snapshot: DrawingSnapshot | null) => {
    if (!snapshot || restoringDrawingRef.current) return;
    pushDrawingHistory(snapshot);
    drawingFuture.current = [];
    refreshDrawingHistory();
  }, [pushDrawingHistory]);

  const restoreDrawingSnapshot = React.useCallback((snapshot: DrawingSnapshot) => {
    const cv = drawRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    restoringDrawingRef.current = true;
    ctx.putImageData(snapshot.raster, 0, 0);
    labelSequence.current = snapshot.labelSequence;
    setSelectedTextObject(null);
    setSelectedStickerObject(null);

    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      restoringDrawingRef.current = false;
      return;
    }
    fabricCanvas.discardActiveObject();
    if (!snapshot.textJson) {
      fabricCanvas.clear();
      fabricCanvas.requestRenderAll();
      restoringDrawingRef.current = false;
      return;
    }
    fabricCanvas.loadFromJSON(snapshot.textJson, () => {
      fabricCanvas.getObjects().forEach(configureFabricEditorObject);
      fabricCanvas.requestRenderAll();
      restoringDrawingRef.current = false;
    });
  }, []);

  const syncTextStyleFromObject = React.useCallback((object: FabricTypes.IText) => {
    const next: TextStyle = {
      fontFamily: object.fontFamily || DEFAULT_TEXT_STYLE.fontFamily,
      fontSize: clampNumber(Number(object.fontSize) || DEFAULT_TEXT_STYLE.fontSize, 8, 120),
      bold: object.fontWeight === "bold" || Number(object.fontWeight) >= 600,
      italic: object.fontStyle === "italic",
      underline: Boolean(object.underline),
      color: typeof object.fill === "string" ? object.fill : DEFAULT_TEXT_STYLE.color,
    };
    textStyleRef.current = next;
    setTextStyle(next);
  }, []);

  const updateTextStyle = React.useCallback((patch: Partial<TextStyle>) => {
    const next = { ...textStyleRef.current, ...patch };
    textStyleRef.current = next;
    setTextStyle(next);
    const active = fabricCanvasRef.current?.getActiveObject();
    const target = isFabricTextObject(active) ? active : selectedTextObject;
    if (!target) return;
    commitDrawingSnapshot(captureDrawingSnapshot());
    target.set({
      fill: next.color,
      fontFamily: next.fontFamily,
      fontSize: next.fontSize,
      fontWeight: next.bold ? "bold" : "normal",
      fontStyle: next.italic ? "italic" : "normal",
      underline: next.underline,
    });
    target.initDimensions();
    target.setCoords();
    fabricCanvasRef.current?.requestRenderAll();
  }, [captureDrawingSnapshot, commitDrawingSnapshot, selectedTextObject]);

  const deleteSelectedFabricObject = React.useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    const active = fabricCanvas?.getActiveObject();
    if (!fabricCanvas || (!isFabricTextObject(active) && !isFabricStickerObject(active))) return;
    if (isFabricTextObject(active) && active.isEditing) return;
    commitDrawingSnapshot(captureDrawingSnapshot());
    fabricCanvas.remove(active);
    fabricCanvas.discardActiveObject();
    setSelectedTextObject(null);
    setSelectedStickerObject(null);
    fabricCanvas.requestRenderAll();
  }, [captureDrawingSnapshot, commitDrawingSnapshot]);

  React.useEffect(() => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => setImg(im);
    im.onerror = () => setError(text("workspaceFollowup.m32c1f244767b"));
    im.src = imageUrl;
  }, [imageUrl]);

  React.useEffect(() => {
    setGridCustomMode(false);
    setGridCustomLines([]);
    setGridCustomHistory([]);
    setGridCustomOrientation("h");
    gridCustomDrag.current = null;
    setBrushZoom(1);
    setBrushPan({ x: 0, y: 0 });
  }, [imageUrl]);

  React.useEffect(() => {
    if (mode !== "brush") {
      spacePressedRef.current = false;
      setSpacePressed(false);
      setBrushPanning(false);
      brushPanDrag.current = null;
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if (event.code === "BracketLeft" || event.code === "BracketRight") {
        event.preventDefault();
        setBrushSize((value) => clampNumber(
          value + (event.code === "BracketRight" ? BRUSH_SIZE_STEP : -BRUSH_SIZE_STEP),
          BRUSH_SIZE_MIN,
          BRUSH_SIZE_MAX,
        ));
        return;
      }
      if (event.code !== "Space") return;
      event.preventDefault();
      spacePressedRef.current = true;
      setSpacePressed(true);
    };
    const stopSpacePan = () => {
      spacePressedRef.current = false;
      setSpacePressed(false);
      setBrushPanning(false);
      brushPanDrag.current = null;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTextEntryTarget(event.target)) return;
      event.preventDefault();
      stopSpacePan();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", stopSpacePan);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", stopSpacePan);
    };
  }, [mode]);

  React.useEffect(() => {
    if (!img || (mode !== "brush" && mode !== "mask")) return;
    const cv = drawRef.current;
    if (!cv) return;
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (mode === "mask") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
    drawingHistory.current = [];
    drawingFuture.current = [];
    refreshDrawingHistory();
    shapeStart.current = null;
    mosaicSession.current = null;
    labelSequence.current = 1;
    transformSnapshotRef.current = null;
    textEditSnapshotRef.current = null;
    textEditHistoryRecordedRef.current = false;
    setSelectedTextObject(null);
    setSelectedStickerObject(null);
    setTextEditing(false);
  }, [img, mode]);

  React.useEffect(() => {
    textStyleRef.current = textStyle;
  }, [textStyle]);

  React.useEffect(() => {
    mosaicStyleRef.current = mosaicStyle;
  }, [mosaicStyle]);

  React.useEffect(() => {
    selectedStickerRef.current = selectedSticker;
  }, [selectedSticker]);

  React.useEffect(() => {
    brushToolRef.current = brushTool;
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const textEnabled = mode === "brush" && brushTool === "text";
    const stickerEnabled = mode === "brush" && brushTool === "mosaic" && mosaicStyle === "sticker";
    const objectLayerEnabled = textEnabled || stickerEnabled;
    const wrapper = textCanvasRef.current?.parentElement;
    if (wrapper) wrapper.style.pointerEvents = objectLayerEnabled ? "auto" : "none";
    fabricCanvas.defaultCursor = textEnabled ? "text" : stickerEnabled ? "crosshair" : "default";
    fabricCanvas.hoverCursor = "move";
    fabricCanvas.getSelectionElement().style.cursor = textEnabled ? "text" : stickerEnabled ? "crosshair" : "default";
    fabricCanvas.getSelectionElement().style.pointerEvents = objectLayerEnabled ? "auto" : "none";
    const active = fabricCanvas.getActiveObject();
    if (!textEnabled && isFabricTextObject(active) && active.isEditing) active.exitEditing();
    if (!textEnabled && isFabricTextObject(active)) {
      setTextControlsVisible(active, false);
    }
    if (!objectLayerEnabled) {
      fabricCanvas.discardActiveObject();
      setSelectedTextObject(null);
      setSelectedStickerObject(null);
      setTextEditing(false);
      fabricCanvas.requestRenderAll();
    }
  }, [brushTool, mode, mosaicStyle]);

  React.useEffect(() => {
    if (!img || mode !== "brush" || !textCanvasRef.current) return;
    let disposed = false;
    let hiddenTransformTextObject: FabricTypes.IText | null = null;

    void import("fabric").then(({ fabric }) => {
      if (disposed || !textCanvasRef.current) return;
      const canvasElement = textCanvasRef.current;
      canvasElement.width = img.naturalWidth;
      canvasElement.height = img.naturalHeight;
      const canvas = new fabric.Canvas(canvasElement, {
        width: img.naturalWidth,
        height: img.naturalHeight,
        selection: false,
        preserveObjectStacking: true,
        renderOnAddRemove: true,
      });
      fabricCanvasRef.current = canvas;
      const wrapper = canvasElement.parentElement;
      if (wrapper) {
        const objectLayerEnabled = brushToolRef.current === "text"
          || (brushToolRef.current === "mosaic" && mosaicStyleRef.current === "sticker");
        wrapper.setAttribute("data-text-object-layer-wrapper", "true");
        Object.assign(wrapper.style, {
          position: "absolute",
          inset: "0",
          width: "100%",
          height: "100%",
          pointerEvents: objectLayerEnabled ? "auto" : "none",
        });
        wrapper.querySelectorAll<HTMLCanvasElement>("canvas").forEach((layer) => {
          Object.assign(layer.style, { width: "100%", height: "100%" });
        });
      }

      const selectEditorObject = (object: FabricTypes.Object | null | undefined) => {
        if (isFabricTextObject(object)) {
          setSelectedTextObject(object);
          setSelectedStickerObject(null);
          syncTextStyleFromObject(object);
        } else if (isFabricStickerObject(object)) {
          setSelectedTextObject(null);
          setSelectedStickerObject(object);
        } else {
          setSelectedTextObject(null);
          setSelectedStickerObject(null);
        }
      };

      const syncSelectedEditorObject = (target: FabricTypes.Object | null | undefined) => {
        selectEditorObject(target);
        if (isFabricTextObject(target) && !target.isEditing) {
          setTextControlsVisible(target, true);
        }
      };

      const hideDeselectedTextControls = (objects: FabricTypes.Object[] | undefined) => {
        objects?.forEach((object) => {
          if (isFabricTextObject(object)) setTextControlsVisible(object, false);
        });
      };

      canvas.on("selection:created", (event) => {
        hideDeselectedTextControls(event.deselected);
        syncSelectedEditorObject(event.selected?.[0] || event.target || canvas.getActiveObject());
      });
      canvas.on("selection:updated", (event) => {
        hideDeselectedTextControls(event.deselected);
        syncSelectedEditorObject(event.selected?.[0] || event.target || canvas.getActiveObject());
      });
      canvas.on("selection:cleared", (event) => {
        hideDeselectedTextControls(event.deselected);
        setSelectedTextObject(null);
        setSelectedStickerObject(null);
        setTextEditing(false);
      });
      canvas.on("before:transform", (event) => {
        if (!restoringDrawingRef.current) transformSnapshotRef.current = captureDrawingSnapshot();
        const target = event.transform?.target || event.target || canvas.getActiveObject();
        const action = event.transform?.action ?? "";
        if (
          isFabricTextObject(target)
          && (action === "rotate" || action.startsWith("scale"))
        ) {
          hiddenTransformTextObject = target;
          setTextControlsVisible(target, false);
        }
      });
      canvas.on("object:modified", (event) => {
        if (transformSnapshotRef.current) {
          commitDrawingSnapshot(transformSnapshotRef.current);
          transformSnapshotRef.current = null;
        }
        const target = event.target;
        if (isFabricTextObject(target) && hiddenTransformTextObject === target) {
          hiddenTransformTextObject = null;
          if (canvas.getActiveObject() === target) {
            setTextControlsVisible(target, true);
            selectEditorObject(target);
          } else {
            setTextControlsVisible(target, false);
          }
        }
      });
      canvas.on("text:editing:entered", (event) => {
        setTextEditing(true);
        const target = event.target;
        if (isFabricTextObject(target)) {
          selectEditorObject(target);
          setTextEditingFrameVisible(target);
        }
        if (skipNextTextEditHistoryRef.current) {
          skipNextTextEditHistoryRef.current = false;
          textEditSnapshotRef.current = null;
          textEditHistoryRecordedRef.current = true;
          return;
        }
        textEditSnapshotRef.current = captureDrawingSnapshot();
        textEditHistoryRecordedRef.current = false;
      });
      canvas.on("text:changed", (event) => {
        const target = event.target;
        if (isFabricTextObject(target)) {
          target.initDimensions();
          setTextEditingFrameVisible(target);
        }
        if (!restoringDrawingRef.current && textEditSnapshotRef.current && !textEditHistoryRecordedRef.current) {
          commitDrawingSnapshot(textEditSnapshotRef.current);
          textEditHistoryRecordedRef.current = true;
        }
      });
      canvas.on("text:editing:exited", (event) => {
        const target = event.target;
        if (isFabricTextObject(target)) {
          if (canvas.getActiveObject() === target) {
            setTextControlsVisible(target, true);
            selectEditorObject(target);
          } else {
            setTextControlsVisible(target, false);
          }
        }
        setTextEditing(false);
        textEditSnapshotRef.current = null;
        textEditHistoryRecordedRef.current = false;
      });
      const createTextObject = (point: CanvasPoint) => {
        commitDrawingSnapshot(captureDrawingSnapshot());
        const currentStyle = textStyleRef.current;
        const text = new fabric.IText("", {
          left: point.x,
          top: point.y,
          originX: "left",
          originY: "top",
          fill: currentStyle.color,
          fontFamily: currentStyle.fontFamily,
          fontSize: currentStyle.fontSize,
          fontWeight: currentStyle.bold ? "bold" : "normal",
          fontStyle: currentStyle.italic ? "italic" : "normal",
          underline: currentStyle.underline,
          padding: 8,
          objectCaching: false,
          lockScalingFlip: true,
        });
        configureFabricTextObject(text);
        canvas.add(text);
        canvas.setActiveObject(text);
        setSelectedTextObject(text);
        skipNextTextEditHistoryRef.current = true;
        setTextControlsVisible(text, false);
        text.enterEditing();
        text.setSelectionStart(0);
        text.setSelectionEnd(0);
        text.set({ width: Math.max(text.width ?? 0, 180) });
        text.setCoords();
        canvas.requestRenderAll();
      };
      const createStickerObject = (point: CanvasPoint) => {
        commitDrawingSnapshot(captureDrawingSnapshot());
        const size = clampNumber(Math.min(canvas.getWidth(), canvas.getHeight()) * 0.18, 48, 240);
        const sticker = new fabric.Text(selectedStickerRef.current, {
          left: point.x,
          top: point.y,
          originX: "center",
          originY: "center",
          fontFamily: "Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif",
          fontSize: size,
          objectCaching: false,
          lockRotation: false,
          lockScalingFlip: true,
        }) as FabricTypes.Text & { editorKind?: "sticker" };
        sticker.editorKind = "sticker";
        configureFabricStickerObject(sticker);
        canvas.add(sticker);
        canvas.setActiveObject(sticker);
        setSelectedTextObject(null);
        setSelectedStickerObject(sticker);
        canvas.requestRenderAll();
      };
      canvas.on("mouse:down", (event) => {
        if (event.target || spacePressedRef.current) return;
        if (brushToolRef.current === "text") {
          createTextObject(canvas.getPointer(event.e));
        } else if (brushToolRef.current === "mosaic" && mosaicStyleRef.current === "sticker") {
          createStickerObject(canvas.getPointer(event.e));
        }
      });
      canvas.on(TEXT_CONTROL_DELETE_EVENT, (event) => {
        const target = event.target;
        if (!isFabricTextObject(target) || target.isEditing) return;
        commitDrawingSnapshot(captureDrawingSnapshot());
        canvas.remove(target);
        canvas.discardActiveObject();
        setSelectedTextObject(null);
        setTextEditing(false);
        canvas.requestRenderAll();
      });

      canvas.calcOffset();
      canvas.requestRenderAll();
    });

    return () => {
      disposed = true;
      const fabricCanvas = fabricCanvasRef.current;
      if (fabricCanvas) {
        fabricCanvas.dispose();
        fabricCanvasRef.current = null;
      }
      setSelectedTextObject(null);
      setSelectedStickerObject(null);
      setTextEditing(false);
    };
  }, [captureDrawingSnapshot, commitDrawingSnapshot, img, mode, syncTextStyleFromObject]);

  React.useLayoutEffect(() => {
    fabricCanvasRef.current?.calcOffset();
  }, [brushPan, brushZoom]);

  React.useEffect(() => {
    if (mode !== "brush") return;
    const onDeleteObject = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isTextEntryTarget(event.target)) return;
      const fabricCanvas = fabricCanvasRef.current;
      const active = fabricCanvas?.getActiveObject();
      if (!fabricCanvas || (!isFabricTextObject(active) && !isFabricStickerObject(active))) return;
      if (isFabricTextObject(active) && active.isEditing) return;
      event.preventDefault();
      deleteSelectedFabricObject();
    };
    window.addEventListener("keydown", onDeleteObject);
    return () => window.removeEventListener("keydown", onDeleteObject);
  }, [deleteSelectedFabricObject, mode]);

  React.useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateStageSize = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    updateStageSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [img, mode]);

  const outpaintPreview = React.useMemo(() => {
    if (!img) return null;
    const leftPixels = Math.round((img.naturalWidth * pad.left) / 100);
    const rightPixels = Math.round((img.naturalWidth * pad.right) / 100);
    const topPixels = Math.round((img.naturalHeight * pad.top) / 100);
    const bottomPixels = Math.round((img.naturalHeight * pad.bottom) / 100);
    const outputWidth = img.naturalWidth + leftPixels + rightPixels;
    const outputHeight = img.naturalHeight + topPixels + bottomPixels;
    const baseScale = Math.min(
      Math.max(1, stageSize.width - 96) / img.naturalWidth,
      Math.max(1, stageSize.height - 96) / img.naturalHeight,
      1,
    );
    const scale = baseScale * outpaintZoom;
    const imageWidth = img.naturalWidth * scale;
    const imageHeight = img.naturalHeight * scale;
    const imageLeft = imageWidth * pad.left / 100;
    const imageTop = imageHeight * pad.top / 100;
    return {
      outputWidth,
      outputHeight,
      canvasWidth: outputWidth * scale,
      canvasHeight: outputHeight * scale,
      imageWidth,
      imageHeight,
      imageLeft,
      imageTop,
      canvasLeft: stageSize.width / 2 - imageWidth / 2 - imageLeft + outpaintPan.x,
      canvasTop: stageSize.height / 2 - imageHeight / 2 - imageTop + outpaintPan.y,
    };
  }, [img, outpaintPan.x, outpaintPan.y, outpaintZoom, pad, stageSize.height, stageSize.width]);

  const gridRects = React.useMemo(
    () =>
      img
        ? buildGridRects(
            img.naturalWidth,
            img.naturalHeight,
            hLines,
            vLines,
            gridGap,
            gridCustomMode ? gridCustomLines : [],
          )
        : [],
    [gridCustomLines, gridCustomMode, gridGap, hLines, img, vLines],
  );

  const gridGuideLines = React.useMemo(() => {
    if (!img) return [] as GridLine[];
    const lines: GridLine[] = [];
    const pushLine = (type: "h" | "v", pos: number) => lines.push({ type, pos: clampNumber(pos, 0, 1) });
    const pushWithGap = (type: "h" | "v", pos: number) => {
      const size = type === "h" ? img.naturalHeight : img.naturalWidth;
      const offset = gridGap > 0 ? gridGap / 2 / Math.max(1, size) : 0;
      if (offset > 0) {
        pushLine(type, pos - offset);
        pushLine(type, pos + offset);
      } else {
        pushLine(type, pos);
      }
    };

    if (gridCustomMode) {
      gridCustomLines.forEach((line) => pushWithGap(line.type, line.pos));
      return lines;
    }

    const rows = hLines + 1;
    const cols = vLines + 1;
    for (let i = 1; i < cols; i++) pushWithGap("v", i / cols);
    for (let i = 1; i < rows; i++) pushWithGap("h", i / rows);
    return lines;
  }, [gridCustomLines, gridCustomMode, gridGap, hLines, img, vLines]);

  const toNatural = (e: React.PointerEvent) => {
    const rect = boxRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * (img?.naturalWidth || 1),
      y: ((e.clientY - rect.top) / rect.height) * (img?.naturalHeight || 1),
    };
  };

  const gridLineHit = (point: { x: number; y: number }, rect: DOMRect) => {
    if (!gridCustomLines.length) return -1;
    const threshold = Math.max(8, Math.min(rect.width, rect.height) / 80);
    let best = -1;
    let bestDist = Infinity;
    gridCustomLines.forEach((line, index) => {
      const dist =
        line.type === "h"
          ? Math.abs(point.y * rect.height - line.pos * rect.height)
          : Math.abs(point.x * rect.width - line.pos * rect.width);
      if (dist <= threshold && dist < bestDist) {
        best = index;
        bestDist = dist;
      }
    });
    return best;
  };

  const setCustomLinePos = (index: number, point: { x: number; y: number }) => {
    setGridCustomLines((lines) =>
      lines.map((line, i) =>
        i === index
          ? { ...line, pos: clampNumber(line.type === "h" ? point.y : point.x, 0.001, 0.999) }
          : line,
      ),
    );
  };

  const applyGridPreset = (presetRows: number, presetCols: number) => {
    setGridCustomMode(false);
    setGridCustomLines([]);
    setGridCustomHistory([]);
    gridCustomDrag.current = null;
    setHLines(clampNumber(presetRows - 1, 0, 20));
    setVLines(clampNumber(presetCols - 1, 0, 20));
  };

  const toggleGridCustomMode = () => {
    setGridCustomMode((enabled) => {
      const next = !enabled;
      setGridCustomLines([]);
      setGridCustomHistory([]);
      gridCustomDrag.current = null;
      return next;
    });
  };

  const undoGridCustomLine = () => {
    setGridCustomHistory((history) => {
      const previous = history[history.length - 1];
      if (!previous) return history;
      setGridCustomLines(previous);
      return history.slice(0, -1);
    });
    gridCustomDrag.current = null;
  };

  const clearGridCustomLines = () => {
    setGridCustomLines([]);
    setGridCustomHistory([]);
    gridCustomDrag.current = null;
  };

  const cropPoint = (e: React.PointerEvent) => {
    const rect = boxRef.current!.getBoundingClientRect();
    return {
      x: clampNumber((e.clientX - rect.left) / rect.width, 0, 1),
      y: clampNumber((e.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const startCropInteraction = (
    event: React.PointerEvent,
    interaction: CropInteraction,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    boxRef.current?.setPointerCapture?.(event.pointerId);
    const point = cropPoint(event);
    cropDrag.current = {
      interaction,
      startX: point.x,
      startY: point.y,
      startCrop: crop,
    };
  };

  const startOutpaintDrag = (event: React.PointerEvent, edge: OutpaintEdge) => {
    const imageRect = imageRef.current?.getBoundingClientRect();
    if (!imageRect) return;
    event.preventDefault();
    event.stopPropagation();
    boxRef.current?.setPointerCapture?.(event.pointerId);
    outpaintDrag.current = {
      edge,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPad: { ...pad },
      imageWidth: Math.max(1, imageRect.width),
      imageHeight: Math.max(1, imageRect.height),
    };
  };

  const startOutpaintPan = (event: React.PointerEvent<HTMLImageElement>) => {
    if (mode !== "outpaint") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    outpaintPanDrag.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPan: { ...outpaintPan },
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (
      mode === "brush"
      && !spacePressedRef.current
      && (brushTool === "text" || (brushTool === "mosaic" && mosaicStyle === "sticker"))
    ) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (mode === "brush" && spacePressedRef.current && e.button === 0) {
      e.preventDefault();
      brushPanDrag.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPan: { ...brushPan },
      };
      setBrushPanning(true);
      return;
    }
    if (mode === "crop") {
      const point = cropPoint(e);
      const nextCrop = { x: point.x, y: point.y, w: 0, h: 0 };
      cropDrag.current = {
        interaction: "create",
        startX: point.x,
        startY: point.y,
        startCrop: nextCrop,
      };
      setCrop(nextCrop);
    } else if (mode === "grid" && gridCustomMode) {
      e.preventDefault();
      const rect = boxRef.current!.getBoundingClientRect();
      const point = {
        x: clampNumber((e.clientX - rect.left) / rect.width, 0.001, 0.999),
        y: clampNumber((e.clientY - rect.top) / rect.height, 0.001, 0.999),
      };
      const hit = gridLineHit(point, rect);
      setGridCustomHistory((history) => [...history, gridCustomLines.map((line) => ({ ...line }))]);
      if (hit >= 0) {
        gridCustomDrag.current = { index: hit, pointerId: e.pointerId };
        setCustomLinePos(hit, point);
      } else {
        const line: GridLine = {
          type: gridCustomOrientation,
          pos: gridCustomOrientation === "h" ? point.y : point.x,
        };
        gridCustomDrag.current = { index: gridCustomLines.length, pointerId: e.pointerId };
        setGridCustomLines((lines) => [...lines, line]);
      }
    } else if (mode === "brush" || mode === "mask") {
      if (mode === "brush" && brushTool === "arrow") setArrowOptionsOpen(false);
      if (mode === "brush" && brushTool === "mosaic") setMosaicOptionsOpen(false);
      const ctx = drawRef.current!.getContext("2d")!;
      const p = toNatural(e);
      const rasterSnapshot = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      const drawingSnapshot = captureDrawingSnapshot();
      if (mode === "brush" && brushTool === "mosaic" && mosaicStyle !== "sticker") {
        const processed = img
          ? createPrivacyEffectCanvas(img, ctx.canvas, mosaicStyle, mosaicBlockSize)
          : null;
        if (!processed) return;
        commitDrawingSnapshot(drawingSnapshot);
        drawing.current = true;
        mosaicSession.current = {
          snapshot: rasterSnapshot,
          pixelated: processed,
          start: p,
          last: p,
          didDraw: mosaicMode === "brush",
        };
        if (mosaicMode === "brush") {
          paintMosaicBrush(ctx, processed, p, p, brushSize);
        }
        return;
      }
      commitDrawingSnapshot(drawingSnapshot);
      ctx.strokeStyle = mode === "mask" ? "#fff" : brushColor;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = brushSize;
      ctx.setLineDash([]);
      if (mode === "brush" && (brushTool === "arrow" || brushTool === "rect" || brushTool === "ellipse")) {
        drawing.current = true;
        shapeStart.current = { x: p.x, y: p.y, snapshot: rasterSnapshot };
        return;
      }
      if (mode === "brush" && brushTool === "label") {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(14, brushSize), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.max(16, brushSize)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(labelSequence.current), p.x, p.y);
        labelSequence.current += 1;
        return;
      }
      drawing.current = true;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (mode === "brush" && brushPanDrag.current) {
      e.preventDefault();
      const drag = brushPanDrag.current;
      setBrushPan({
        x: drag.startPan.x + e.clientX - drag.startClientX,
        y: drag.startPan.y + e.clientY - drag.startClientY,
      });
    } else if (mode === "crop" && cropDrag.current) {
      const point = cropPoint(e);
      const drag = cropDrag.current;
      if (drag.interaction === "create") {
        setCrop({
          x: Math.min(drag.startX, point.x),
          y: Math.min(drag.startY, point.y),
          w: Math.abs(point.x - drag.startX),
          h: Math.abs(point.y - drag.startY),
        });
      } else {
        setCrop(updateCropRect(
          drag.startCrop,
          drag.interaction,
          point.x - drag.startX,
          point.y - drag.startY,
        ));
      }
    } else if (mode === "outpaint" && outpaintDrag.current) {
      e.preventDefault();
      const drag = outpaintDrag.current;
      const horizontalDelta = drag.edge === "left"
        ? drag.startClientX - e.clientX
        : e.clientX - drag.startClientX;
      const verticalDelta = drag.edge === "top"
        ? drag.startClientY - e.clientY
        : e.clientY - drag.startClientY;
      const deltaPercent = drag.edge === "left" || drag.edge === "right"
        ? horizontalDelta / drag.imageWidth * 100
        : verticalDelta / drag.imageHeight * 100;
      setPad({
        ...drag.startPad,
        [drag.edge]: Math.round(clampNumber(drag.startPad[drag.edge] + deltaPercent, 0, 100)),
      });
    } else if (mode === "outpaint" && outpaintPanDrag.current) {
      e.preventDefault();
      const drag = outpaintPanDrag.current;
      setOutpaintPan({
        x: drag.startPan.x + e.clientX - drag.startClientX,
        y: drag.startPan.y + e.clientY - drag.startClientY,
      });
    } else if (mode === "grid" && gridCustomMode && gridCustomDrag.current) {
      e.preventDefault();
      const rect = boxRef.current!.getBoundingClientRect();
      setCustomLinePos(gridCustomDrag.current.index, {
        x: clampNumber((e.clientX - rect.left) / rect.width, 0.001, 0.999),
        y: clampNumber((e.clientY - rect.top) / rect.height, 0.001, 0.999),
      });
    } else if ((mode === "brush" || mode === "mask") && drawing.current) {
      const ctx = drawRef.current!.getContext("2d")!;
      const p = toNatural(e);
      const activeMosaicSession = mosaicSession.current;
      if (mode === "brush" && brushTool === "mosaic" && activeMosaicSession) {
        if (mosaicMode === "brush") {
          paintMosaicBrush(ctx, activeMosaicSession.pixelated, activeMosaicSession.last, p, brushSize);
          activeMosaicSession.last = p;
          activeMosaicSession.didDraw = true;
        } else {
          activeMosaicSession.didDraw = paintMosaicShape(ctx, activeMosaicSession, p, mosaicMode);
        }
        return;
      }
      if (mode === "brush" && shapeStart.current) {
        const start = shapeStart.current;
        ctx.putImageData(start.snapshot, 0, 0);
        ctx.strokeStyle = brushColor;
        ctx.fillStyle = brushColor;
        ctx.lineWidth = brushSize;
        const width = p.x - start.x;
        const height = p.y - start.y;
        ctx.setLineDash([]);
        if (brushTool === "rect") {
          ctx.strokeRect(start.x, start.y, width, height);
        } else if (brushTool === "ellipse") {
          ctx.beginPath();
          ctx.ellipse(start.x + width / 2, start.y + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (brushTool === "arrow") {
          drawCanvasArrow(ctx, start, p, arrowHeadStyle, arrowLineStyle, brushSize);
        }
        return;
      }
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  };

  const onPointerUp = () => {
    const activeMosaicSession = mosaicSession.current;
    if (activeMosaicSession && !activeMosaicSession.didDraw) {
      drawingHistory.current.pop();
      refreshDrawingHistory();
    }
    mosaicSession.current = null;
    cropDrag.current = null;
    outpaintDrag.current = null;
    outpaintPanDrag.current = null;
    gridCustomDrag.current = null;
    brushPanDrag.current = null;
    setBrushPanning(false);
    drawing.current = false;
    shapeStart.current = null;
  };

  const onPointerLeave = () => {
    if (mode !== "crop" && mode !== "outpaint" && !brushPanDrag.current) onPointerUp();
  };

  const onOutpaintWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (mode !== "outpaint" && mode !== "brush") return;
    event.preventDefault();
    const delta = event.deltaY * 0.001;
    if (mode === "brush") {
      setBrushZoom((value) => Number(clampNumber(value - delta, BRUSH_ZOOM_MIN, IMAGE_EDITOR_ZOOM_MAX).toFixed(2)));
    } else {
      setOutpaintZoom((value) => Number(clampNumber(value - delta, 0.25, IMAGE_EDITOR_ZOOM_MAX).toFixed(2)));
    }
  };

  const undoDrawing = React.useCallback(() => {
    if (restoringDrawingRef.current) return;
    const current = captureDrawingSnapshot();
    if (!current) return;
    const previous = drawingHistory.current.pop();
    if (!previous) return;
    drawingFuture.current.push(current);
    restoreDrawingSnapshot(previous);
    refreshDrawingHistory();
  }, [captureDrawingSnapshot, restoreDrawingSnapshot]);

  const redoDrawing = React.useCallback(() => {
    if (restoringDrawingRef.current) return;
    const current = captureDrawingSnapshot();
    if (!current) return;
    const next = drawingFuture.current.pop();
    if (!next) return;
    pushDrawingHistory(current);
    restoreDrawingSnapshot(next);
    refreshDrawingHistory();
  }, [captureDrawingSnapshot, pushDrawingHistory, restoreDrawingSnapshot]);

  React.useEffect(() => {
    if (mode !== "brush" && mode !== "mask") return;
    const onHistoryShortcut = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      const command = event.ctrlKey || event.metaKey;
      if (!command) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.stopPropagation();
        event.shiftKey ? redoDrawing() : undoDrawing();
        return;
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        event.stopPropagation();
        redoDrawing();
      }
    };
    window.addEventListener("keydown", onHistoryShortcut);
    return () => window.removeEventListener("keydown", onHistoryShortcut);
  }, [mode, redoDrawing, undoDrawing]);

  const clearDraw = () => {
    const cv = drawRef.current;
    if (!cv || !img) return;
    const ctx = cv.getContext("2d")!;
    commitDrawingSnapshot(captureDrawingSnapshot());
    ctx.clearRect(0, 0, cv.width, cv.height);
    labelSequence.current = 1;
    const fabricCanvas = fabricCanvasRef.current;
    if (fabricCanvas) {
      fabricCanvas.clear();
      fabricCanvas.requestRenderAll();
      setSelectedTextObject(null);
      setSelectedStickerObject(null);
    }
    if (mode === "mask") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
  };

  const apply = async () => {
    if (!img) return;
    if (mode === "outpaint" && !Object.values(pad).some((value) => value > 0)) {
      setError(text("workspaceFollowup.mfe9eb2dcaa98"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const urls: string[] = [];
      const media: CanvasMediaIdentity[] = [];
      const files: File[] = [];
      const exportCanvas = async (canvas: HTMLCanvasElement, name: string) => {
        const blob = await toBlob(canvas);
        if (onFilesResult) {
          files.push(new File([blob], name, { type: blob.type || "image/png" }));
        } else {
          const result = await uploadBlob(blob, name, canvas);
          urls.push(result.url);
          media.push(result);
        }
      };
      if (mode === "crop") {
        const sx = Math.round(crop.x * img.naturalWidth);
        const sy = Math.round(crop.y * img.naturalHeight);
        const sw = Math.max(1, Math.round(crop.w * img.naturalWidth));
        const sh = Math.max(1, Math.round(crop.h * img.naturalHeight));
        const cv = document.createElement("canvas");
        cv.width = sw;
        cv.height = sh;
        cv.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const cropFile = new File([await toBlob(cv)], "crop.png", { type: "image/png" });
        if (onFilesResult) await onFilesResult([cropFile], mode);
        else await onResult([], mode, cropFile, { width: sw, height: sh });
        onClose();
        return;
      } else if (mode === "brush") {
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        const ctx = cv.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        ctx.drawImage(drawRef.current!, 0, 0);
        const fabricCanvas = fabricCanvasRef.current;
        if (fabricCanvas && textCanvasRef.current) {
          fabricCanvas.discardActiveObject();
          fabricCanvas.renderAll();
          const textLayer = fabricCanvas.toCanvasElement();
          ctx.drawImage(textLayer, 0, 0, cv.width, cv.height);
        }
        await exportCanvas(cv, "brush.png");
      } else if (mode === "mask") {
        await exportCanvas(drawRef.current!, "mask.png");
      } else if (mode === "outpaint") {
        const lw = Math.round((img.naturalWidth * pad.left) / 100);
        const rw = Math.round((img.naturalWidth * pad.right) / 100);
        const th = Math.round((img.naturalHeight * pad.top) / 100);
        const bh = Math.round((img.naturalHeight * pad.bottom) / 100);
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth + lw + rw;
        cv.height = img.naturalHeight + th + bh;
        const ctx = cv.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, lw, th);
        const outpaintFile = new File([await toBlob(cv)], "outpaint.png", { type: "image/png" });
        if (onFilesResult) await onFilesResult([outpaintFile], mode);
        else await onResult([], mode, outpaintFile, { width: cv.width, height: cv.height });
        onClose();
        return;
      } else if (mode === "grid") {
        const rects = buildGridRects(
          img.naturalWidth,
          img.naturalHeight,
          hLines,
          vLines,
          gridGap,
          gridCustomMode ? gridCustomLines : [],
        ).sort((a, b) => a.row - b.row || a.col - b.col);
        const digits = String(rects.length).length;
        for (let i = 0; i < rects.length; i++) {
          const rect = rects[i];
          const cv = document.createElement("canvas");
          cv.width = rect.w;
          cv.height = rect.h;
          cv.getContext("2d")!.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
          const order = String(i + 1).padStart(digits, "0");
          await exportCanvas(cv, `grid_${order}_r${rect.row + 1}_c${rect.col + 1}.png`);
        }
      }
      if (files.length && onFilesResult) {
        await onFilesResult(files, mode);
        onClose();
      } else if (urls.length) {
        await onResult(urls, mode, undefined, undefined, media);
        onClose();
      } else {
        setError(text("workspaceFollowup.mbfd2b28f52cf"));
      }
    } catch (e: any) {
      setError(String(e?.message || "处理失败"));
    } finally {
      setBusy(false);
    }
  };

  const drawingMode = mode === "brush" || mode === "mask";
  const objectLayerEnabled = mode === "brush"
    && (brushTool === "text" || (brushTool === "mosaic" && mosaicStyle === "sticker"));
  const applyLabel =
    mode === "preview" ? "关闭预览" :
    mode === "crop" ? "裁剪导出" :
    mode === "grid" ? "切分导出" :
    mode === "outpaint" ? "生成扩图" :
    mode === "mask" ? "生成遮罩" :
    "应用画笔";

  return (
    <Portal>
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-[color-mix(in_srgb,var(--app-bg)_72%,transparent)] p-4" onClick={onClose}>
      <UiProps ids={{"aria-label":["canvas.m6054ebcc17ef"]}}><div role="dialog" aria-modal="true" aria-label="canvas.m6054ebcc17ef" className="flex h-[min(760px,calc(100vh-2rem))] w-[min(1120px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={[
                "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]",
                mode === m.id ? "bg-[var(--panel-2)] text-[var(--app-fg)]" : "text-[var(--app-muted)] hover:bg-[var(--panel-2)]",
              ].join(" ")}
            >
              {m.icon} {uiLabel(m.label)}
            </button>
          ))}
          <button onClick={onClose} className="ml-auto rounded-lg p-1.5 text-[var(--app-muted)] hover:bg-[var(--panel-2)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={stageRef} onWheel={onOutpaintWheel} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--app-bg)] p-4">
          <div
            ref={boxRef}
            data-outpaint-canvas={mode === "outpaint" ? true : undefined}
            className={[
              "relative select-none",
              mode === "outpaint" ? "" : "max-h-full max-w-full",
              mode === "outpaint" ? "" : mode === "brush" ? (brushPanning ? "" : "transition-transform duration-75") : "transition-[width,height] duration-75",
              mode === "outpaint" ? "border border-[var(--primary-bg)] shadow-[var(--shadow-2)]" : "",
              mode === "brush" && brushPanning ? "cursor-grabbing" : mode === "brush" && spacePressed ? "cursor-grab" : "",
              mode === "grid" && gridCustomMode ? (gridCustomOrientation === "h" ? "cursor-row-resize" : "cursor-col-resize") : "",
            ].join(" ")}
            style={mode === "outpaint" && outpaintPreview ? {
              touchAction: "none",
              position: "absolute",
              left: outpaintPreview.canvasLeft,
              top: outpaintPreview.canvasTop,
              width: outpaintPreview.canvasWidth,
              height: outpaintPreview.canvasHeight,
              backgroundColor: "#fff",
            } : mode === "brush" ? {
              touchAction: "none",
              transform: `translate(${brushPan.x}px, ${brushPan.y}px) scale(${brushZoom})`,
            } : { touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={imageUrl}
              alt=""
              data-outpaint-pan-target={mode === "outpaint" ? true : undefined}
              className={mode === "outpaint" ? "absolute block cursor-grab object-contain active:cursor-grabbing" : "block max-h-[580px] max-w-full object-contain"}
              draggable={false}
              onPointerDown={mode === "outpaint" ? (event) => startOutpaintPan(event) : undefined}
              style={mode === "outpaint" && outpaintPreview ? {
                left: outpaintPreview.imageLeft,
                top: outpaintPreview.imageTop,
                width: outpaintPreview.imageWidth,
                height: outpaintPreview.imageHeight,
              } : undefined}
            />
            {drawingMode && <canvas ref={drawRef} className={`pointer-events-none absolute inset-0 h-full w-full ${mode === "mask" ? "mix-blend-screen opacity-50" : ""}`} />}
            {mode === "brush" && (
              <canvas
                ref={textCanvasRef}
                data-text-object-layer="true"
                className={`absolute inset-0 h-full w-full ${objectLayerEnabled ? "pointer-events-auto" : "pointer-events-none"}`}
              />
            )}
            {mode === "crop" && (
              <div
                data-crop-selection="true"
                className="absolute cursor-move border-2 border-[var(--primary-bg)] bg-[color-mix(in_srgb,var(--primary-bg)_10%,transparent)]"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                onPointerDown={(event) => startCropInteraction(event, "move")}
              >
                <div data-crop-handle="n" className="absolute -top-3 left-1/2 z-10 flex h-6 w-8 -translate-x-1/2 cursor-ns-resize items-center justify-center" onPointerDown={(event) => startCropInteraction(event, "n")}><span data-crop-control="box" className="h-3 w-3 rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" /></div>
                <div data-crop-handle="e" className="absolute -right-3 top-1/2 z-10 flex h-8 w-6 -translate-y-1/2 cursor-ew-resize items-center justify-center" onPointerDown={(event) => startCropInteraction(event, "e")}><span data-crop-control="box" className="h-3 w-3 rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" /></div>
                <div data-crop-handle="s" className="absolute -bottom-3 left-1/2 z-10 flex h-6 w-8 -translate-x-1/2 cursor-ns-resize items-center justify-center" onPointerDown={(event) => startCropInteraction(event, "s")}><span data-crop-control="box" className="h-3 w-3 rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" /></div>
                <div data-crop-handle="w" className="absolute -left-3 top-1/2 z-10 flex h-8 w-6 -translate-y-1/2 cursor-ew-resize items-center justify-center" onPointerDown={(event) => startCropInteraction(event, "w")}><span data-crop-control="box" className="h-3 w-3 rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" /></div>
                <div data-crop-handle="nw" data-crop-control="box" className="absolute -left-1.5 -top-1.5 z-20 h-3 w-3 cursor-nwse-resize rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" onPointerDown={(event) => startCropInteraction(event, "nw")} />
                <div data-crop-handle="ne" data-crop-control="box" className="absolute -right-1.5 -top-1.5 z-20 h-3 w-3 cursor-nesw-resize rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" onPointerDown={(event) => startCropInteraction(event, "ne")} />
                <div data-crop-handle="se" data-crop-control="box" className="absolute -bottom-1.5 -right-1.5 z-20 h-3 w-3 cursor-nwse-resize rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" onPointerDown={(event) => startCropInteraction(event, "se")} />
                <div data-crop-handle="sw" data-crop-control="box" className="absolute -bottom-1.5 -left-1.5 z-20 h-3 w-3 cursor-nesw-resize rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" onPointerDown={(event) => startCropInteraction(event, "sw")} />
              </div>
            )}
            {mode === "outpaint" && (
              <>
                {outpaintPreview && (
                  <div
                    data-outpaint-resolution
                    className="pointer-events-none absolute left-3 top-3 z-30 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1 text-[12px] font-semibold tabular-nums text-[var(--app-fg)] shadow-[var(--shadow)]"
                  >
                    {outpaintPreview.outputWidth} × {outpaintPreview.outputHeight}
                  </div>
                )}
                <div data-outpaint-handle="top" className="absolute -top-3 left-1/2 z-20 flex h-6 w-12 -translate-x-1/2 cursor-ns-resize items-center justify-center" onPointerDown={(event) => startOutpaintDrag(event, "top")}><span data-outpaint-control="box" className="h-3 w-3 rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" /></div>
                <div data-outpaint-handle="right" className="absolute -right-3 top-1/2 z-20 flex h-12 w-6 -translate-y-1/2 cursor-ew-resize items-center justify-center" onPointerDown={(event) => startOutpaintDrag(event, "right")}><span data-outpaint-control="box" className="h-3 w-3 rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" /></div>
                <div data-outpaint-handle="bottom" className="absolute -bottom-3 left-1/2 z-20 flex h-6 w-12 -translate-x-1/2 cursor-ns-resize items-center justify-center" onPointerDown={(event) => startOutpaintDrag(event, "bottom")}><span data-outpaint-control="box" className="h-3 w-3 rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" /></div>
                <div data-outpaint-handle="left" className="absolute -left-3 top-1/2 z-20 flex h-12 w-6 -translate-y-1/2 cursor-ew-resize items-center justify-center" onPointerDown={(event) => startOutpaintDrag(event, "left")}><span data-outpaint-control="box" className="h-3 w-3 rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm" /></div>
              </>
            )}
            {mode === "grid" && (
              <div className="pointer-events-none absolute inset-0">
                {gridGuideLines.map((line, i) => (
                  <div
                    key={`${line.type}${i}`}
                    data-grid-guide-line={line.type}
                    className={[
                      "absolute bg-[color-mix(in_srgb,var(--app-fg)_38%,var(--app-bg))]",
                      line.type === "v" ? "top-0 h-full w-px" : "left-0 h-px w-full",
                    ].join(" ")}
                    style={line.type === "v" ? { left: `${line.pos * 100}%` } : { top: `${line.pos * 100}%` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--app-muted)]">
          {mode === "crop" && <span><UiText id="canvas.m3a0b2aa50774" /></span>}
          {mode === "preview" && <span><UiText id="canvas.m9f79348da35a" /></span>}
          {drawingMode && (
            <>
              {mode === "brush" && (
                <div data-brush-zoom className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--input-bg)]">
                  <UiProps ids={{"aria-label":["canvas.mf49744d01d25"]}}><button type="button" aria-label="canvas.mf49744d01d25" onClick={() => setBrushZoom((value) => clampNumber(value - 0.1, BRUSH_ZOOM_MIN, IMAGE_EDITOR_ZOOM_MAX))} className="h-7 w-7 rounded-l-lg hover:bg-[var(--panel-2)]">−</button></UiProps>
                  <UiProps ids={{"aria-label":["canvas.m84e17bdb244f"]}}><button type="button" aria-label="canvas.m84e17bdb244f" onClick={() => { setBrushZoom(1); setBrushPan({ x: 0, y: 0 }); }} className="min-w-12 border-x border-[var(--border)] px-2 py-1 tabular-nums hover:bg-[var(--panel-2)]">{Math.round(brushZoom * 100)}%</button></UiProps>
                  <UiProps ids={{"aria-label":["canvas.madf4bbd3ee3e"]}}><button type="button" aria-label="canvas.madf4bbd3ee3e" onClick={() => setBrushZoom((value) => clampNumber(value + 0.1, BRUSH_ZOOM_MIN, IMAGE_EDITOR_ZOOM_MAX))} className="h-7 w-7 rounded-r-lg hover:bg-[var(--panel-2)]">+</button></UiProps>
                </div>
              )}
              {mode === "brush" && <span className="text-[11px] opacity-70"><UiText id="canvas.mbd9b9ce5a3ba" /></span>}
              <span>
                {mode === "mask"
                  ? <UiText id="canvas.m5dca12d2de4d" />
                  : brushTool === "mosaic" && mosaicStyle === "sticker"
                    ? <UiText id="canvas.m398bac4fa01c" />
                    : <UiText id="canvas.m2dbdd53fc199" />}
              </span>
              {mode === "brush" && (
                <div className="relative flex items-center gap-1">
                  {([
                    ["free", "自由画笔", Brush],
                    ["arrow", "箭头", MoveUpRight],
                    ["mosaic", "马赛克", MosaicIcon],
                    ["rect", "矩形", Square],
                    ["ellipse", "椭圆", Circle],
                    ["label", "数字标签", ListOrdered],
                    ["text", "文字标签", Type],
                  ] as const).map(([tool, label, ToolIcon]) => (
                    <button
                      key={tool}
                      type="button"
                      title={uiLabel(label)}
                      aria-pressed={brushTool === tool}
                      onClick={() => {
                        setBrushTool(tool);
                        setArrowOptionsOpen(tool === "arrow" && (brushTool !== "arrow" || !arrowOptionsOpen));
                        setMosaicOptionsOpen(tool === "mosaic" && (brushTool !== "mosaic" || !mosaicOptionsOpen));
                      }}
                      className={`rounded-lg border p-1.5 ${brushTool === tool ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]"}`}
                    >
                      <ToolIcon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                  {brushTool === "arrow" && arrowOptionsOpen && (
                    <div
                      data-arrow-options
                      className="absolute bottom-full left-0 z-50 mb-2 flex w-max max-w-[calc(100vw-3rem)] flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-[var(--app-fg)] shadow-[var(--shadow-2)]"
                    >
                      <UiProps ids={{"aria-label":["canvas.m5c0140b89859"]}}><div className="flex items-center gap-1" aria-label="canvas.m5c0140b89859">
                        {ARROW_WIDTH_PRESETS.map((width) => (
                          <button
                            key={width}
                            type="button"
                            title={`${width}px`}
                            aria-label={text("workspaceFollowup.mfbe376f5686a", { v0: width })}
                            onClick={() => setBrushSize(width)}
                            className={`grid h-8 w-8 place-items-center rounded-md border ${brushSize === width ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]"}`}
                          >
                            <span className="rounded-full bg-current" style={{ width: Math.max(2, width), height: Math.max(2, width) }} />
                          </button>
                        ))}
                      </div></UiProps>
                      <span className="h-7 w-px bg-[var(--border)]" />
                      <UiProps ids={{"aria-label":["canvas.m6368a2801efc"]}}><div className="flex items-center gap-1" aria-label="canvas.m6368a2801efc">
                        {([
                          ["none", "直线", Minus],
                          ["end", "末端箭头", ArrowRight],
                          ["start", "起点箭头", ArrowLeft],
                          ["both", "双向箭头", MoveHorizontal],
                        ] as const).map(([style, label, StyleIcon]) => (
                          <button
                            key={style}
                            type="button"
                            title={uiLabel(label)}
                            aria-label={uiLabel(label)}
                            onClick={() => setArrowHeadStyle(style)}
                            className={`grid h-8 w-10 place-items-center rounded-md border ${arrowHeadStyle === style ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]"}`}
                          >
                            <StyleIcon className="h-4 w-5" />
                          </button>
                        ))}
                      </div></UiProps>
                      <span className="h-7 w-px bg-[var(--border)]" />
                      <UiProps ids={{"aria-label":["canvas.m5e6fa2a44d0e"]}}><div className="flex items-center gap-1" aria-label="canvas.m5e6fa2a44d0e">
                        {(["solid", "dashed", "dotted"] as const).map((style) => (
                          <button
                            key={style}
                            type="button"
                            title={{ solid: text("workspaceFollowup.mcada027120f1"), dashed: text("workspaceFollowup.m3978a356f89e"), dotted: text("workspaceFollowup.m4ca78bbb3826") }[style]}
                            aria-label={{ solid: text("workspaceFollowup.mcada027120f1"), dashed: text("workspaceFollowup.m3978a356f89e"), dotted: text("workspaceFollowup.m4ca78bbb3826") }[style]}
                            onClick={() => setArrowLineStyle(style)}
                            className={`grid h-8 w-10 place-items-center rounded-md border ${arrowLineStyle === style ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]"}`}
                          >
                            <span className={`w-6 border-t-2 ${style === "solid" ? "border-solid" : style === "dashed" ? "border-dashed" : "border-dotted"}`} />
                          </button>
                        ))}
                      </div></UiProps>
                      <span className="h-7 w-px bg-[var(--border)]" />
                      <UiProps ids={{"aria-label":["canvas.md20bac2b0907"]}}><div className="grid grid-cols-6 gap-1" aria-label="canvas.md20bac2b0907">
                        {ARROW_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            title={color}
                            aria-label={text("workspaceFollowup.mf5024a2fbe80", { v0: color })}
                            onClick={() => setBrushColor(color)}
                            className={`h-5 w-5 rounded-sm border ${brushColor === color ? "ring-2 ring-[var(--primary-bg)] ring-offset-1 ring-offset-[var(--panel-bg)]" : "border-[var(--border)]"}`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div></UiProps>
                    </div>
                  )}
                  {brushTool === "mosaic" && mosaicOptionsOpen && (
                    <div
                      data-mosaic-options
                      className="absolute bottom-full left-0 z-50 mb-2 flex w-max max-w-[calc(100vw-3rem)] flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-[var(--app-fg)] shadow-[var(--shadow-2)]"
                    >
                      <UiProps ids={{"aria-label":["canvas.m526367aad554"]}}><div className="flex items-center gap-1" aria-label="canvas.m526367aad554">
                        {([
                          ["pixel", "像素", "经典像素马赛克"],
                          ["blur", "模糊", "柔化模糊"],
                          ["portrait-blocks", "色块", "人像色块化"],
                          ["sticker", "贴纸", "表情贴纸遮脸"],
                        ] as const).map(([style, label, title]) => (
                          <button
                            key={style}
                            type="button"
                            title={uiLabel(title)}
                            aria-label={uiLabel(title)}
                            aria-pressed={mosaicStyle === style}
                            onClick={() => setMosaicStyle(style)}
                            className={`h-8 rounded-md border px-2 text-xs ${mosaicStyle === style ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]"}`}
                          >
                            {uiLabel(label)}
                          </button>
                        ))}
                      </div></UiProps>
                      <span className="h-7 w-px bg-[var(--border)]" />
                      {mosaicStyle === "sticker" ? (
                        <>
                          <UiProps ids={{"aria-label":["canvas.m511c3f17d186"]}}><div className="flex items-center gap-1" aria-label="canvas.m511c3f17d186">
                            {MOSAIC_STICKERS.map((sticker) => (
                              <button
                                key={sticker}
                                type="button"
                                title={text("workspaceFollowup.mee80084f406d", { v0: sticker })}
                                aria-label={text("workspaceFollowup.mee80084f406d", { v0: sticker })}
                                aria-pressed={selectedSticker === sticker}
                                onClick={() => setSelectedSticker(sticker)}
                                className={`grid h-9 w-9 place-items-center rounded-md border text-xl leading-none ${selectedSticker === sticker ? "border-[var(--primary-bg)] bg-[var(--panel-2)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]"}`}
                              >
                                {sticker}
                              </button>
                            ))}
                          </div></UiProps>
                          {selectedStickerObject && (
                            <span className="rounded-md bg-[var(--panel-2)] px-2 py-1 text-xs text-[var(--app-muted)]"><UiText id="canvas.m1c9652033754" /></span>
                          )}
                          <button
                            type="button"
                            disabled={!selectedStickerObject}
                            onClick={deleteSelectedFabricObject}
                            className="h-8 rounded-md border border-[var(--border)] px-2 text-xs hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-40"
                          ><UiText id="canvas.m469f67cf665e" /></button>
                        </>
                      ) : (
                        <>
                          <UiProps ids={{"aria-label":["canvas.m0265bfc2e46a"]}}><div className="flex items-center gap-1" aria-label="canvas.m0265bfc2e46a">
                            {([
                              ["brush", "圆形画笔", Brush],
                              ["rect", "矩形框选", Square],
                              ["ellipse", "椭圆框选", Circle],
                            ] as const).map(([nextMode, label, ModeIcon]) => (
                              <button
                                key={nextMode}
                                type="button"
                                title={uiLabel(label)}
                                aria-label={uiLabel(label)}
                                aria-pressed={mosaicMode === nextMode}
                                onClick={() => setMosaicMode(nextMode)}
                                className={`grid h-8 w-8 place-items-center rounded-md border ${mosaicMode === nextMode ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]"}`}
                              >
                                <ModeIcon className="h-4 w-4" />
                              </button>
                            ))}
                          </div></UiProps>
                          <span className="h-7 w-px bg-[var(--border)]" />
                          <span
                            aria-hidden="true"
                            className="grid h-7 w-7 grid-cols-2 overflow-hidden rounded border border-[var(--border)]"
                          >
                            <span className="bg-[var(--app-muted)]" />
                            <span className="bg-[var(--panel-2)]" />
                            <span className="bg-[var(--panel-2)]" />
                            <span className="bg-[var(--app-muted)]" />
                          </span>
                          <span>{mosaicStyle === "pixel" ? <UiText id="canvas.mb82bd426d236" /> : <UiText id="canvas.ma2846644a638" />}</span>
                          <input
                            aria-label={text("workspaceFollowup.m2f5a9c7b1ade", { v0: mosaicStyle === "pixel" ? text("workspaceFollowup.m2e76b36df37c") : text("workspaceFollowup.madcd47869dec") })}
                            type="range"
                            min={MOSAIC_BLOCK_MIN}
                            max={MOSAIC_BLOCK_MAX}
                            value={mosaicBlockSize}
                            onChange={(event) => setMosaicBlockSize(Number(event.target.value))}
                          />
                          <span className="min-w-8 rounded-md bg-[var(--panel-2)] px-1.5 py-1 text-center tabular-nums">
                            {mosaicBlockSize}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                  {brushTool === "text" && !textEditing && (
                    <div
                      data-text-options
                      className="absolute bottom-full left-0 z-50 mb-2 flex w-max max-w-[calc(100vw-3rem)] flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-[var(--app-fg)] shadow-[var(--shadow-2)]"
                    >
                      <div className="flex items-center gap-1">
                        <UiProps ids={{"aria-label":["canvas.m9fa078164482"]}}><button
                          type="button"
                          aria-label="canvas.m9fa078164482"
                          aria-pressed={textStyle.bold}
                          onClick={() => updateTextStyle({ bold: !textStyle.bold })}
                          className={`grid h-8 w-8 place-items-center rounded-md border text-sm font-bold ${textStyle.bold ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]"}`}
                        >
                          B
                        </button></UiProps>
                        <UiProps ids={{"aria-label":["canvas.md42d79dfaec8"]}}><button
                          type="button"
                          aria-label="canvas.md42d79dfaec8"
                          aria-pressed={textStyle.italic}
                          onClick={() => updateTextStyle({ italic: !textStyle.italic })}
                          className={`grid h-8 w-8 place-items-center rounded-md border text-sm italic ${textStyle.italic ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]"}`}
                        >
                          I
                        </button></UiProps>
                        <UiProps ids={{"aria-label":["canvas.me665c8f3682f"]}}><button
                          type="button"
                          aria-label="canvas.me665c8f3682f"
                          aria-pressed={textStyle.underline}
                          onClick={() => updateTextStyle({ underline: !textStyle.underline })}
                          className={`grid h-8 w-8 place-items-center rounded-md border text-sm underline ${textStyle.underline ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]"}`}
                        >
                          A
                        </button></UiProps>
                      </div>
                      <span className="h-7 w-px bg-[var(--border)]" />
                      <FrostedSelect
                        value={textStyle.fontFamily}
                        onChange={(fontFamily) => updateTextStyle({ fontFamily })}
                        options={TEXT_FONT_OPTIONS}
                        ariaLabel={text("workspaceFollowup.m840474936e41")}
                        side="top"
                        compact
                        showLeading={false}
                        className="w-36"
                        buttonClassName="!h-8 !rounded-md !shadow-none"
                        menuClassName="!z-[1200]"
                      />
                      <UiProps ids={{"aria-label":["canvas.mc396a619c511"]}}><input
                        type="number"
                        aria-label="canvas.mc396a619c511"
                        min={8}
                        max={120}
                        step={1}
                        value={textStyle.fontSize}
                        onChange={(event) => updateTextStyle({ fontSize: clampNumber(Number(event.target.value), 8, 120) })}
                        className="h-8 w-16 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 text-center tabular-nums text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-bg)_24%,transparent)]"
                      /></UiProps>
                      <span className="text-[11px] text-[var(--app-muted)]">px</span>
                      <span className="h-7 w-px bg-[var(--border)]" />
                      <UiProps ids={{"aria-label":["canvas.mf21ef4aba5ab"]}}><div className="grid grid-cols-10 gap-1" aria-label="canvas.mf21ef4aba5ab">
                        {TEXT_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            title={color}
                            aria-label={text("workspaceFollowup.m70ade7735632", { v0: color })}
                            onClick={() => updateTextStyle({ color })}
                            className={`h-5 w-5 rounded-sm border ${textStyle.color === color ? "ring-2 ring-[var(--primary-bg)] ring-offset-1 ring-offset-[var(--panel-bg)]" : "border-[var(--border)]"}`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div></UiProps>
                      <UiProps ids={{"aria-label":["canvas.m8c1a80d53b7a"]}}><input
                        type="color"
                        aria-label="canvas.m8c1a80d53b7a"
                        value={textStyle.color}
                        onChange={(event) => updateTextStyle({ color: event.target.value })}
                        className="h-8 w-9 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--input-bg)] p-0.5"
                      /></UiProps>
                    </div>
                  )}
                </div>
              )}
              {(mode === "mask" || (
                brushTool !== "text"
                && (brushTool !== "mosaic" || (mosaicStyle !== "sticker" && mosaicMode === "brush"))
              )) && (
                <>
                  <UiProps ids={{"title":["canvas.ma40bc03bf63e"]}}><span title="canvas.ma40bc03bf63e">{mode === "brush" && brushTool === "mosaic" ? <UiText id="canvas.mae72b532f4b8" /> : <UiText id="canvas.m1b1433027862" />}</span></UiProps>
                  <input type="range" min={BRUSH_SIZE_MIN} max={BRUSH_SIZE_MAX} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
                  <span className="min-w-12 rounded-lg bg-[var(--panel-2)] px-2 py-1 text-center tabular-nums text-[var(--app-fg)]">{brushSize}px</span>
                </>
              )}
              {mode === "brush" && brushTool !== "mosaic" && brushTool !== "text" && <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="h-6 w-8 rounded" />}
              <UiProps ids={{"title":["canvas.m7b05fec5f512"]}}><button type="button" onClick={undoDrawing} disabled={!drawingHistory.current.length} title="canvas.m7b05fec5f512" className="rounded-lg border border-[var(--border)] p-1.5 hover:bg-[var(--panel-2)] disabled:opacity-40"><Undo2 className="h-3.5 w-3.5" /></button></UiProps>
              <UiProps ids={{"title":["canvas.m6d7130644bbe"]}}><button type="button" onClick={redoDrawing} disabled={!drawingFuture.current.length} title="canvas.m6d7130644bbe" className="rounded-lg border border-[var(--border)] p-1.5 hover:bg-[var(--panel-2)] disabled:opacity-40"><Redo2 className="h-3.5 w-3.5" /></button></UiProps>
              <button onClick={clearDraw} className="rounded-lg border border-[var(--border)] px-2 py-1 hover:bg-[var(--panel-2)]"><UiText id="canvas.m1ef3de06b32e" /></button>
            </>
          )}
          {mode === "outpaint" && (
            <div className="flex items-center gap-2">
              <div data-outpaint-zoom className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--input-bg)]">
                <UiProps ids={{"aria-label":["canvas.mf69af426f317"]}}><button type="button" aria-label="canvas.mf69af426f317" onClick={() => setOutpaintZoom((value) => clampNumber(value - 0.1, 0.25, IMAGE_EDITOR_ZOOM_MAX))} className="h-7 w-7 rounded-l-lg hover:bg-[var(--panel-2)]">−</button></UiProps>
                <UiProps ids={{"aria-label":["canvas.m4060fd26580c"]}}><button type="button" aria-label="canvas.m4060fd26580c" onClick={() => { setOutpaintZoom(1); setOutpaintPan({ x: 0, y: 0 }); }} className="min-w-12 border-x border-[var(--border)] px-2 py-1 tabular-nums hover:bg-[var(--panel-2)]">{Math.round(outpaintZoom * 100)}%</button></UiProps>
                <UiProps ids={{"aria-label":["canvas.mc4ba409c6bbe"]}}><button type="button" aria-label="canvas.mc4ba409c6bbe" onClick={() => setOutpaintZoom((value) => clampNumber(value + 0.1, 0.5, IMAGE_EDITOR_ZOOM_MAX))} className="h-7 w-7 rounded-r-lg hover:bg-[var(--panel-2)]">+</button></UiProps>
              </div>
              <span><UiText id="canvas.m96f2ec762a44" /></span>
              {(["top", "right", "bottom", "left"] as const).map((k) => (
                <span key={k} className="flex items-center gap-1">
                  {{ top: text("workspaceFollowup.mdb5ba671d244"), right: text("workspaceFollowup.m14ab1f2bce0a"), bottom: text("workspaceFollowup.m13c12b064b63"), left: text("workspaceFollowup.me2e0c454e5d5") }[k]}
                  <input
                    data-outpaint-input={k}
                    type="number"
                    min={0}
                    max={100}
                    value={pad[k]}
                    onChange={(e) => setPad((p) => ({ ...p, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                    className="w-12 rounded-lg border border-[var(--border)] bg-transparent px-1.5 py-1 outline-none"
                  />
                  %
                </span>
              ))}
            </div>
          )}
          {mode === "grid" && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleGridCustomMode}
                className={[
                  "rounded-full border px-3 py-1 font-semibold",
                  gridCustomMode ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]",
                ].join(" ")}
              ><UiText id="canvas.m4eafa9e925b3" /></button>
              {!gridCustomMode && (
                <>
                  <span className="text-[11px] opacity-70"><UiText id="canvas.mf1de1e2621de" /></span>
                  {GRID_PRESETS.map(([presetRows, presetCols]) => (
                    <button
                      key={`${presetRows}x${presetCols}`}
                      type="button"
                      onClick={() => applyGridPreset(presetRows, presetCols)}
                      className="rounded-full border border-[var(--border)] px-2.5 py-1 font-semibold hover:bg-[var(--panel-2)]"
                    >
                      {presetRows}×{presetCols}
                    </button>
                  ))}
                  <span><UiText id="canvas.mefdbcb13014e" /></span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={hLines}
                    onChange={(e) => setHLines(clampNumber(Math.round(Number(e.target.value) || 0), 0, 20))}
                    className="w-14 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 outline-none"
                  />
                  <span><UiText id="canvas.m30fe8742e4ef" /></span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={vLines}
                    onChange={(e) => setVLines(clampNumber(Math.round(Number(e.target.value) || 0), 0, 20))}
                    className="w-14 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 outline-none"
                  />
                </>
              )}
              {gridCustomMode && (
                <>
                  <button
                    type="button"
                    onClick={() => setGridCustomOrientation("h")}
                    className={[
                      "rounded-full border px-3 py-1 font-semibold",
                      gridCustomOrientation === "h" ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]",
                    ].join(" ")}
                  ><UiText id="canvas.m4995b90d72fc" /></button>
                  <button
                    type="button"
                    onClick={() => setGridCustomOrientation("v")}
                    className={[
                      "rounded-full border px-3 py-1 font-semibold",
                      gridCustomOrientation === "v" ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] hover:bg-[var(--panel-2)]",
                    ].join(" ")}
                  ><UiText id="canvas.m1777a1e5f3a5" /></button>
                  <button
                    type="button"
                    onClick={undoGridCustomLine}
                    disabled={!gridCustomHistory.length}
                    className="rounded-full border border-[var(--border)] px-3 py-1 font-semibold hover:bg-[var(--panel-2)] disabled:opacity-40"
                  ><UiText id="canvas.m926a50b98ece" /></button>
                  <button
                    type="button"
                    onClick={clearGridCustomLines}
                    className="rounded-full border border-[var(--border)] px-3 py-1 font-semibold hover:bg-[var(--panel-2)]"
                  ><UiText id="canvas.m1ef3de06b32e" /></button>
                </>
              )}
              <span><UiText id="canvas.m1b0a7572eb4d" /></span>
              <input
                type="range"
                min={0}
                max={240}
                step={1}
                value={gridGap}
                onChange={(e) => setGridGap(clampNumber(Number(e.target.value) || 0, 0, 240))}
                className="w-32"
              />
              <span className="min-w-8 rounded-full bg-[var(--panel-2)] px-2 py-1 text-center font-semibold">{gridGap}</span>
              <span><UiText id="canvas.mb04c769b040a" />{gridRects.length}<UiText id="canvas.me9e0fdc242b4" /></span>
            </div>
          )}
          {error && <span className="text-[var(--error-fg,var(--app-fg))]">{uiError(error)}</span>}
          <button onClick={mode === "preview" ? onClose : apply} disabled={busy || !img} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary-bg)] px-3.5 py-1.5 text-[12px] text-[var(--primary-fg)] disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{uiLabel(applyLabel)}
          </button>
        </div>
      </div></UiProps>
    </div>
    </Portal>
  );
}
