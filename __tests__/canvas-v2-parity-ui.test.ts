import { verifyMaterialToolbar } from './helpers/canvas-ui-contract-harness';
import { verifyImageFallback } from './helpers/canvas-ui-contract-harness';
import { verifyKeyboardCommands } from './helpers/canvas-selection-contract';
import { verifyPreviewNavigation } from './helpers/canvas-ui-contract-harness';
import fs from "node:fs";
import { readChineseUiSource } from "./helpers/chinese-ui-source";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readChineseUiSource(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

describe("canvas v2 reference interaction parity", () => {
  it("shows contextual image, video, and audio actions on selected nodes", () => {
    const node = read("components/canvas/CanvasNodeCard.tsx");
    for (const label of ["预览", "裁剪", "画笔", "宫格", "下载"]) {
      expect(node).toContain(label);
    }
    expect(node).toContain('<CanvasVideoFrameControl placement="toolbar" />');
    expect(read("components/canvas/CanvasVideoFrameControls.tsx")).toContain("截取当前帧");
    expect(node).toContain('panelSelected && data.kind === "image"');
    expect(node).toContain('panelSelected && data.kind === "video"');
    expect(node).toContain("previewMedia");
    expect(node).toContain("downloadMedia");
    const mediaBranchStart = node.indexOf('if (data.kind === "image" || data.kind === "video" || data.kind === "audio") {');
    const mediaBranchEnd = node.indexOf("  return (\n    <div className={`relative", mediaBranchStart);
    expect(node.slice(mediaBranchStart, mediaBranchEnd).match(/<CanvasMaterialToolbar>/g)).toHaveLength(3);
  });

  it("removes mask and outpaint entries from node toolbars and editor tabs", () => {
    const node = read("components/canvas/CanvasNodeCard.tsx");
    const editor = read("components/canvas/ImageEditorModal.tsx");
    for (const label of ["扩图", "遮罩"]) {
      expect(node).not.toContain(`title="${label}"`);
      expect(editor).not.toContain(`label: "${label}"`);
    }
  });

  it("omits redundant edit and library actions from image toolbars while keeping crop", () => {
    const node = read("components/canvas/CanvasNodeCard.tsx");

    expect(node).not.toContain('<ToolbarButton title="编辑"');
    expect(node).not.toContain('<ToolbarButton title="入库"');
    expect(node.match(/<ToolbarButton title="裁剪"/g)).toHaveLength(2);
    expect(node).toContain('editOutput(id, latestBatch.id, coverOutput.id, "crop")');
    expect(node).toContain('openImageEditor(id, "crop")');
  });

  it("keeps uploaded images borderless with their remaining actions in the selected toolbar", async () => { await verifyMaterialToolbar('image'); await verifyImageFallback(); const node = read('components/canvas/CanvasNodeCard.tsx'); expect(node).not.toContain('data.name && <p className="truncate px-3 py-2'); });

  it("shows material names and intrinsic resolution above media, with the toolbar above both", () => {
    const node = read("components/canvas/CanvasNodeCard.tsx");
    const board = read("components/canvas/SmartCanvasBoard.tsx");

    expect(node).toContain("data-canvas-material-metadata");
    expect(node).toContain("formatCanvasMediaResolution(data)");
    expect(node).toContain("getMediaName(id)");
    expect(node).toContain("getTaskResultName(id");
    expect(node).toContain("hydrateCanvasMediaDimensions");
    expect(node).toContain("const CANVAS_MATERIAL_METADATA_TOOLBAR_OFFSET = 36");
    expect(node).toContain("offset={CANVAS_MATERIAL_METADATA_TOOLBAR_OFFSET}");
    expect(board).toContain("getCanvasMediaNodeName(documentRef.current, nodeId)");
    expect(board).toContain("getCanvasImageOutputName(documentRef.current, nodeId, batchId, outputId)");
  });

  it("keeps image resize chrome hidden while the selected frame and toolbar stay available", () => {
    const node = read("components/canvas/CanvasNodeCard.tsx");
    const imageNodeStart = node.indexOf('if (data.kind === "image" || data.kind === "video" || data.kind === "audio") {');
    const imageNode = node.slice(imageNodeStart, node.indexOf("  return (\n    <div className={`relative", imageNodeStart));
    expect(imageNode).toContain("<NodeResizer isVisible={false}");
    expect(imageNode).not.toContain("<NodeResizer isVisible={panelSelected}");
    expect(imageNode).toContain('panelSelected && data.kind === "image" && !uploading && <CanvasMaterialToolbar');
    expect(imageNode).toContain('nodeSelected ? "canvas-material-frame-selected" : ""');
  });

  it("renders uploaded image connection handles as compact plus circles with forgiving hit targets", () => {
    const node = read("components/canvas/CanvasNodeCard.tsx");
    const imageNodeStart = node.indexOf('if (data.kind === "image" || data.kind === "video" || data.kind === "audio") {');
    const imageNode = node.slice(imageNodeStart, node.indexOf("  return (\n    <div className={`relative", imageNodeStart));
    expect(imageNode).toContain("imageTargetHandleClassName");
    expect(imageNode).toContain("data-canvas-media-body-target");
    expect(imageNode).toContain("CANVAS_MEDIA_BODY_TARGET_HANDLE_ID");
    const handle = read("components/canvas/CanvasConnectionHandle.tsx");
    expect(imageNode).toContain('<CanvasConnectionHandle handleId={CANVAS_MEDIA_INPUT_HANDLE_ID} type="target"');
    expect(imageNode).toContain('<CanvasConnectionHandle type="source"');
    expect(handle).toContain("!h-0 !w-0");
    expect(handle).toContain("CANVAS_CONNECTION_HANDLE_HIT_SIZE");
    expect(handle).toContain('width="20" height="20" viewBox="0 0 20 20"');
    expect(handle).toContain('fill="var(--canvas-handle-bg)"');
    expect(handle).toContain('stroke="var(--canvas-handle-icon)"');
    expect(handle).toContain('M10 ${plusStart}v${plusSize}M${plusStart} 10h${plusSize}');
    expect(imageNode).not.toContain("!bg-[var(--primary-bg)]");
  });

  it("keeps the enlarged media view focused on playback and inspection", async () => {

    await verifyPreviewNavigation(2);
  });

  it("hides the media position counter when only one item is being previewed", async () => {

    await verifyPreviewNavigation(1);
  });

  it("supports zooming and dragging image previews for detail inspection", () => {
    const preview = read("components/canvas/CanvasMediaPreview.tsx");
    for (const token of [
      'aria-label="缩小图片"',
      'aria-label="放大图片"',
      "onWheel={handleImageWheel}",
      "onPointerDown={startImageDrag}",
      "onDoubleClick={resetImageView}",
    ]) {
      expect(preview).toContain(token);
    }
  });

  it("adds preview, drawing shapes, labels, zoom, and undo redo to the image editor", () => {
    const editor = read("components/canvas/ImageEditorModal.tsx");
    for (const token of ["preview", "arrow", "rect", "ellipse", "label", "text", "undoDrawing", "redoDrawing", "brushZoom", "brushPan", "data-brush-zoom"]) {
      expect(editor).toContain(token);
    }
    expect(editor).not.toContain('{ id: "resize", label: "缩放"');
    expect(editor).toContain("const IMAGE_EDITOR_ZOOM_MAX = 10");
    expect(editor).toContain("const BRUSH_ZOOM_MIN = 0.01");
    expect(editor).toContain("const BRUSH_SIZE_MIN = 1");
    expect(editor).toContain('aria-label="缩小画笔画布"');
    expect(editor).toContain('aria-label="重置画笔画布缩放"');
    expect(editor).toContain('aria-label="放大画笔画布"');
    expect(editor).toContain("event.code !== \"Space\"");
    expect(editor).toContain("spacePressedRef.current = true");
    expect(editor).toContain("spacePressedRef.current && e.button === 0");
    expect(editor).toContain("isTextEntryTarget");
    expect(editor).not.toContain('closest("input, textarea, select, button, a")');
    expect(editor).toContain('event.code === "BracketLeft" || event.code === "BracketRight"');
    expect(editor).not.toContain("brushSizeWheelPressed");
    expect(editor).toContain("快捷键：[ 缩小，] 放大");
    expect(editor).toContain("{brushSize}px");
    expect(editor).toContain("drawCanvasArrow");
    expect(editor).toContain("const shaftStart = hasStartHead");
    expect(editor).toContain("const shaftEnd = hasEndHead");
    expect(editor).toContain("ctx.moveTo(shaftStart.x, shaftStart.y)");
    expect(editor).toContain("ctx.lineTo(shaftEnd.x, shaftEnd.y)");
    expect(editor).toContain("data-arrow-options");
    expect(editor).toContain("ARROW_WIDTH_PRESETS");
    expect(editor).toContain("ARROW_COLORS");
    expect(editor).toContain('type ArrowHeadStyle = "none" | "end" | "start" | "both"');
    expect(editor).toContain('type ArrowLineStyle = "solid" | "dashed" | "dotted"');
    expect(editor).toContain("按住空格 + 拖拽移动");
    expect(editor).toContain("transform: `translate(${brushPan.x}px, ${brushPan.y}px) scale(${brushZoom})`");
    expect(editor).toContain('mode !== "outpaint" && mode !== "brush"');
    for (const token of [
      'import type { fabric as FabricTypes } from "fabric"',
      "const textCanvasRef",
      "const fabricCanvasRef",
      'void import("fabric")',
      "new fabric.Canvas",
      "new fabric.IText",
      'data-text-object-layer="true"',
      'objectLayerEnabled ? "pointer-events-auto" : "pointer-events-none"',
      "data-text-options",
      "TEXT_FONT_OPTIONS",
      "TEXT_COLORS",
      "FrostedSelect",
      'ariaLabel="文字字体"',
      'aria-label="文字字号"',
      'aria-label="文字粗体"',
      'aria-label="文字斜体"',
      'aria-label="文字下划线"',
      'aria-label="自定义文字颜色"',
      "updateTextStyle",
      "type DrawingSnapshot",
      "captureDrawingSnapshot",
      "restoreDrawingSnapshot",
      "fabricCanvas.toJSON(",
      "fabricCanvas.loadFromJSON",
      "textCanvasRef.current",
      "ctx.drawImage(textLayer",
      'event.key !== "Delete" && event.key !== "Backspace"',
    ]) {
      expect(editor).toContain(token);
    }
  });

  it("enters text placement mode first, then creates an editable field on the image", () => {
    const editor = read("components/canvas/ImageEditorModal.tsx");

    expect(editor).toContain("fontSize: 60,");
    expect(editor).toContain('menuClassName="!z-[1200]"');
    expect(editor).toContain('fabricCanvas.getSelectionElement().style.cursor = textEnabled ? "text"');
    expect(editor).toContain('fabricCanvas.getSelectionElement().style.pointerEvents = objectLayerEnabled ? "auto" : "none"');
    expect(editor).toContain('new fabric.IText("", {');
    expect(editor).not.toContain('new fabric.IText("  ", {');
    expect(editor).toContain('selectionColor: "rgba(0, 0, 0, 0)"');
    expect(editor).toContain('editingBorderColor: "#ffffff"');
    expect(editor).toContain("cornerSize: TEXT_CONTROL_VISUAL_SIZE");
    expect(editor).toContain("borderScaleFactor: 2");
    expect(editor).toContain("padding: 8");
    expect(editor).toContain("lockMovementX: false");
    expect(editor).toContain("lockMovementY: false");
    expect(editor).toContain('brushTool === "text" && !textEditing');
    expect(editor).toContain("setTextEditing(true)");
    expect(editor).toContain("setTextEditing(false)");
    expect(editor).toContain("text.enterEditing()");
    expect(editor).toContain("text.setSelectionStart(0)");
    expect(editor).toContain("text.setSelectionEnd(0)");
    expect(editor).not.toContain("text.selectAll()");
    expect(editor).toContain("width: Math.max(text.width ?? 0, 180)");
    expect(editor).toContain("setTextControlsVisible(text, false)");
    for (const token of [
      'const TEXT_CONTROL_DELETE_EVENT = "editor:text-delete"',
      "const TEXT_CONTROL_VISUAL_SIZE = 36",
      "const TEXT_CONTROL_HIT_SIZE = 64",
      "const TEXT_CONTROL_ROTATE_OFFSET = 56",
      "const TEXT_CONTROL_ROTATE_CURSOR =",
      "function cloneFabricControl",
      "function renderTextControlIcon",
      "function setTextControlsVisible",
      "function setTextEditingFrameVisible",
      "hasControls: false, hasBorders: true",
      '"scale-nwse"',
      '"scale-nesw"',
      '"rotate"',
      '"delete"',
      "controls.tl = cloneFabricControl(controls.tl, renderTextScaleNwse",
      "controls.bl = cloneFabricControl(controls.bl, renderTextScaleNesw",
      "controls.br = cloneFabricControl(controls.br, renderTextScaleNwse",
      "controls.tr = cloneFabricControl(",
      "renderTextDeleteControl",
      'actionName: "delete"',
      "offsetY: -TEXT_CONTROL_ROTATE_OFFSET",
      "withConnection: true",
      "mouseUpHandler: requestTextControlDelete",
      'cursorStyleHandler: () => "pointer"',
      "cursorStyleHandler: () => TEXT_CONTROL_ROTATE_CURSOR",
      'hoverCursor: "move"',
      'borderColor: "#ffffff"',
      'canvas.on("selection:created"',
      'canvas.on("selection:updated"',
      'canvas.on("text:editing:entered"',
      'canvas.on("text:editing:exited"',
      "canvas.on(TEXT_CONTROL_DELETE_EVENT",
      'action === "rotate" || action.startsWith("scale")',
      "setTextControlsVisible(target, true)",
      "setTextControlsVisible(target, false)",
      "target.initDimensions()",
      'ctx.fillText("↻", 0, 1)',
    ]) {
      expect(editor).toContain(token);
    }
    for (const token of [
      "TEXT_CONTROL_DELETE_KEY",
      "TEXT_CONTROL_DELETE_OFFSET_X",
      "TEXT_CONTROL_DELETE_OFFSET_Y",
      "TEXT_CONTROL_REVEAL_MS",
      "TEXT_CONTROL_DELETE_CURSOR",
      "textControlRevealTimerRef",
      "initialTextControlObjectRef",
      "clearTextControlRevealTimer",
      "drawInitialEditingTextControls",
      "TEXT_CONTROL_HOVER_LEAVE_MS",
      "showHoveredTextControls",
      "scheduleTextControlLeave",
      "textControlLeaveTimer",
      "hoveredTextObject",
      "lastTextPointerEvent",
      "pointerStillInside",
      'canvas.on("mouse:over"',
      'canvas.on("mouse:out"',
      'canvas.on("mouse:move"',
      'canvas.on("after:render"',
    ]) {
      expect(editor).not.toContain(token);
    }
    expect(editor).not.toContain('const enteringText = tool === "text" && brushTool !== "text"');
    expect(editor).not.toContain("createTextObjectRef.current?.()");

    const textEditingLifecycle = editor.slice(
      editor.indexOf('canvas.on("text:editing:entered"'),
      editor.indexOf('canvas.on("text:editing:exited"'),
    );
    expect(textEditingLifecycle).toContain("setTextEditingFrameVisible(target)");
    expect(textEditingLifecycle).not.toContain("setTextControlsVisible(target, false)");

    const textStyleUpdater = editor.slice(
      editor.indexOf("const updateTextStyle"),
      editor.indexOf("const deleteSelectedFabricObject"),
    );
    expect(textStyleUpdater).toContain("fabricCanvasRef.current?.getActiveObject()");
    expect(textStyleUpdater).toContain("target.initDimensions()");

    const textEditingExit = editor.slice(
      editor.indexOf('canvas.on("text:editing:exited"'),
      editor.indexOf("const createTextObject"),
    );
    expect(textEditingExit).toContain("canvas.getActiveObject() === target");
    expect(textEditingExit).toContain("setTextControlsVisible(target, true)");

    const pointerHandler = editor.slice(
      editor.indexOf("const onPointerDown"),
      editor.indexOf("const onPointerMove"),
    );
    expect(pointerHandler.indexOf('brushTool === "text"')).toBeLessThan(
      pointerHandler.indexOf("setPointerCapture"),
    );
  });

  it("passes the applied image editor mode back so crop results use the fixed crop name", () => {
    const editor = read("components/canvas/ImageEditorModal.tsx");
    const board = read("components/canvas/SmartCanvasBoard.tsx");

    expect(editor).toContain("onResult: (urls: string[], mode: Mode, sourceFile?: File, sourceSize?: ImageSize, media?: CanvasMediaIdentity[]) => void");
    expect(editor).toContain("onResult(urls, mode, undefined, undefined, media)");
    expect(board).toContain("CANVAS_IMAGE_EDIT_LABELS.crop");
    expect(board).toContain("addEditedImages(imageEditor.nodeId, urls, mode, sourceFile, sourceSize, media)");
  });

  it("adds crop results immediately with a fixed name and a source connection", () => {
    const editor = read("components/canvas/ImageEditorModal.tsx");
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    const uploadFiles = board.slice(board.indexOf("const uploadFiles"), board.indexOf("const onNodesChange"));
    const addEditedImages = board.slice(board.indexOf("const addEditedImages"), board.indexOf("const exportVideoFrame"));
    const crop = addEditedImages.slice(0, addEditedImages.indexOf('if (mode === "outpaint")'));

    expect(editor).toContain('const cropFile = new File([await toBlob(cv)], "crop.png", { type: "image/png" })');
    expect(editor).toContain('await onResult([], mode, cropFile, { width: sw, height: sh })');
    expect(crop).toContain('if (mode === "crop")');
    expect(crop).toContain("CANVAS_IMAGE_EDIT_LABELS.crop");
    expect(uploadFiles).toContain("connectFromId?: string");
    expect(uploadFiles).toContain("source: connectFromId");
    expect(uploadFiles).toContain("target: nodeId");
    expect(uploadFiles).toContain("edges: [...current.edges, ...connectedEdges]");
    expect(crop).toContain("return;");
    expect(board).toContain('localPreview: localPreview && kind === "image" ? true : undefined');
  });

  it("names every derived image node after the editor tool that created it", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    const addEditedImages = board.slice(board.indexOf("const addEditedImages"), board.indexOf("const exportVideoFrame"));
    const outpaint = addEditedImages.slice(addEditedImages.indexOf('if (mode === "outpaint")'), addEditedImages.indexOf("const createdNodeIds"));
    const otherEdits = addEditedImages.slice(addEditedImages.indexOf("const createdNodeIds"));

    for (const [mode, label] of [
      ["crop", "裁剪"],
      ["brush", "画笔"],
      ["mask", "遮罩"],
      ["outpaint", "扩图"],
      ["grid", "宫格"],
    ]) {
      expect(board).toContain(`${mode}: "${label}"`);
    }
    expect(outpaint).toContain("name: CANVAS_IMAGE_EDIT_LABELS.outpaint");
    expect(outpaint.match(/name: CANVAS_IMAGE_EDIT_LABELS\.outpaint/g) ?? []).toHaveLength(2);
    expect(otherEdits).toContain("CANVAS_IMAGE_EDIT_LABELS[mode]");
  });

  it("uses four draggable white-canvas handles and hands the padded image to a task", () => {
    const editor = read("components/canvas/ImageEditorModal.tsx");
    const board = read("components/canvas/SmartCanvasBoard.tsx");

    for (const edge of ["top", "right", "bottom", "left"]) {
      expect(editor).toContain(`data-outpaint-handle="${edge}"`);
      expect(editor).toContain(`startOutpaintDrag(event, "${edge}")`);
    }
    expect(editor.match(/data-outpaint-control="box"/g) ?? []).toHaveLength(4);
    expect(editor).toContain('data-outpaint-control="box" className="h-3 w-3 rounded-sm border border-[var(--primary-fg)] bg-[var(--primary-bg)] shadow-sm"');
    expect(editor).toContain("data-outpaint-input={k}");
    expect(editor).toContain("data-outpaint-canvas");
    expect(editor).toContain('backgroundColor: "#fff"');
    expect(editor).toContain("...drag.startPad,");
    expect(editor).toContain('mode === "outpaint" ? "" : mode === "brush" ? (brushPanning ? "" : "transition-transform duration-75") : "transition-[width,height] duration-75"');
    expect(editor).toContain("data-outpaint-zoom");
    expect(editor).toContain("onWheel={onOutpaintWheel}");
    expect(editor).toContain("event.deltaY * 0.001");
    expect(editor).toContain("0.25, IMAGE_EDITOR_ZOOM_MAX");
    expect(editor).toContain('aria-label="缩小扩图画布"');
    expect(editor).toContain('aria-label="放大扩图画布"');
    expect(editor).toContain("canvasLeft");
    expect(editor).toContain("canvasTop");
    expect(editor).toContain("await onResult(urls, mode, undefined, undefined, media)");
    expect(board).toContain('if (mode === "outpaint")');
    expect(editor).toContain("await onResult([], mode, outpaintFile, { width: cv.width, height: cv.height })");
    expect(board).toContain("uploadCanvasMedia(outpaintFile)");
  });

  it("shows the exact outpaint output resolution and updates it from the live padding state", () => {
    const editor = read("components/canvas/ImageEditorModal.tsx");

    expect(editor).toContain("data-outpaint-resolution");
    expect(editor).toContain("const leftPixels = Math.round((img.naturalWidth * pad.left) / 100)");
    expect(editor).toContain("const rightPixels = Math.round((img.naturalWidth * pad.right) / 100)");
    expect(editor).toContain("const topPixels = Math.round((img.naturalHeight * pad.top) / 100)");
    expect(editor).toContain("const bottomPixels = Math.round((img.naturalHeight * pad.bottom) / 100)");
    expect(editor).toContain("const outputWidth = img.naturalWidth + leftPixels + rightPixels");
    expect(editor).toContain("const outputHeight = img.naturalHeight + topPixels + bottomPixels");
    expect(editor).toContain("{outpaintPreview.outputWidth} × {outpaintPreview.outputHeight}");
    expect(editor).toContain("canvasWidth: outputWidth * scale");
    expect(editor).toContain("canvasHeight: outputHeight * scale");
  });

  it("creates a connected outpaint image node and standard image task without submitting generation", () => {
    const editor = read("components/canvas/ImageEditorModal.tsx");
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    const addEditedImages = board.slice(board.indexOf("const addEditedImages"), board.indexOf("const exportVideoFrame"));
    const outpaint = addEditedImages.slice(addEditedImages.indexOf('if (mode === "outpaint")'), addEditedImages.indexOf("const createdNodeIds"));

    expect(editor).toContain('const outpaintFile = new File([await toBlob(cv)], "outpaint.png"');
    expect(editor).toContain("await onResult([], mode, outpaintFile, { width: cv.width, height: cv.height })");
    expect(outpaint).toContain('const imageNodeId = id("image")');
    expect(outpaint).toContain('type: "image"');
    expect(outpaint).toMatch(/kind: "image", url: objectUrl, name: CANVAS_IMAGE_EDIT_LABELS.outpaint,[^}]*localPreview: true/);
    expect(outpaint).toContain('type: "imageTask"');
    expect(outpaint).toContain("URL.createObjectURL(outpaintFile)");
    expect(outpaint).toContain("prompt: \"\"");
    expect(outpaint).toContain("batches: []");
    expect(outpaint).toContain("setSelectedIds([taskNodeId])");
    expect(outpaint).toContain("setOpenTaskPanelNodeId(taskNodeId)");
    expect(outpaint).toContain("window.requestAnimationFrame");
    expect(outpaint).toContain("nodes: laidOut.nodes");
    expect(outpaint).toContain("void (async () =>");
    expect(outpaint).toContain("uploadCanvasMedia(outpaintFile)");
    expect(outpaint).toContain("references: [{");
    expect(outpaint).toContain("url: objectUrl");
    expect(outpaint).toContain("url: payload.url");
    expect(outpaint).toContain("edges: addEdge({");
    expect(outpaint).toContain("source: imageNodeId");
    expect(outpaint).toContain("target: taskNodeId");
    expect(outpaint).toContain('type: "default"');
    expect(outpaint).not.toContain("createImageTaskBatch");
    expect(outpaint).not.toContain("submitImageGen");
    expect(outpaint).not.toContain("waitForGenerationResult");
    expect(outpaint).not.toContain("updateImageOutput");
    expect(outpaint).not.toContain("addGeneratedMedia");
  });

  it("shows the local outpaint image immediately while its upload continues", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    const node = read("components/canvas/CanvasNodeCard.tsx");
    const addEditedImages = board.slice(board.indexOf("const addEditedImages"), board.indexOf("const exportVideoFrame"));
    const outpaint = addEditedImages.slice(addEditedImages.indexOf('if (mode === "outpaint")'), addEditedImages.indexOf("const createdNodeIds"));

    expect(outpaint).toContain("localPreview: true");
    expect(outpaint).toContain('settleUpload(imageNodeId, objectUrl, { status: "success"');
    expect(node).toContain("const showPendingMediaPreview = uploading");
    expect(node).toContain("canvas-media-uploading-preview");
    expect(node).toContain("canvas-media-uploading-overlay");
  });

  it("keeps the canvas viewport unchanged after applying outpaint", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    const addEditedImages = board.slice(board.indexOf("const addEditedImages"), board.indexOf("const exportVideoFrame"));
    const outpaint = addEditedImages.slice(addEditedImages.indexOf('if (mode === "outpaint")'), addEditedImages.indexOf("const createdNodeIds"));

    expect(outpaint).not.toContain("flow.fitView");
  });

  it("keeps local outpaint nodes out of autosave until background upload settles", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    const addEditedImages = board.slice(board.indexOf("const addEditedImages"), board.indexOf("const exportVideoFrame"));
    const outpaint = addEditedImages.slice(addEditedImages.indexOf('if (mode === "outpaint")'), addEditedImages.indexOf("const createdNodeIds"));

    expect(outpaint).toContain("pendingUploadUrlsRef.current.set(imageNodeId, objectUrl)");
    expect(outpaint).toContain("pendingUploadUrlsRef.current.set(taskNodeId, objectUrl)");
    expect(outpaint).toContain("pendingUploadUrlsRef.current.delete(imageNodeId)");
    expect(outpaint).toContain("pendingUploadUrlsRef.current.delete(taskNodeId)");
  });

  it("keeps the white-edge preview in the normal image node instead of the task result frame", () => {
    const node = read("components/canvas/CanvasNodeCard.tsx");
    const board = read("components/canvas/SmartCanvasBoard.tsx");

    expect(board).toContain("width: outpaintSize.width");
    expect(board).toContain("height: outpaintSize.height");
    expect(board).not.toContain("previewReferenceId: referenceId");
    expect(node).not.toContain("data-canvas-task-input-preview");
  });

  it("centers the outpaint material and lets its whole preview pan independently", () => {
    const editor = read("components/canvas/ImageEditorModal.tsx");

    expect(editor).toContain("const [outpaintPan, setOutpaintPan]");
    expect(editor).toMatch(/const observer = new ResizeObserver\(updateStageSize\);[\s\S]*?observer\.disconnect\(\);\r?\n  }, \[img, mode\]\);/);
    expect(editor).toContain("canvasLeft: stageSize.width / 2 - imageWidth / 2 - imageLeft + outpaintPan.x");
    expect(editor).toContain("canvasTop: stageSize.height / 2 - imageHeight / 2 - imageTop + outpaintPan.y");
    expect(editor).toContain("data-outpaint-pan-target");
    expect(editor).toContain("startOutpaintPan(event)");
    expect(editor).toContain("x: drag.startPan.x + e.clientX - drag.startClientX");
    expect(editor).toContain("y: drag.startPan.y + e.clientY - drag.startClientY");
  });

  it("lets the crop selection move and resize from every edge and corner", () => {
    const editor = read("components/canvas/ImageEditorModal.tsx");
    expect(editor).toContain('data-crop-selection="true"');
    for (const handle of ["n", "e", "s", "w", "nw", "ne", "se", "sw"]) {
      expect(editor).toContain(`data-crop-handle="${handle}"`);
    }
    expect(editor.match(/data-crop-control="box"/g) ?? []).toHaveLength(8);
    expect(editor).toContain('startCropInteraction(event, "move")');
    expect(editor).toContain("拖动裁剪框移动，拖动边缘或角点调整大小");
  });

  it("exposes the workflow, shortcut, and asset panels without a run-log surface", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    for (const label of ["工作流", "快捷键", "产物库"]) expect(board).toContain(label);
    expect(board).not.toContain('aria-label="运行日志"');
    expect(board).not.toContain("还没有运行记录");
    expect(fs.existsSync(path.join(root, "components/canvas/CanvasShortcutPanel.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(root, "components/canvas/CanvasWorkflowPanel.tsx"))).toBe(true);
    expect(read("components/canvas/CanvasShortcutPanel.tsx")).toContain("data-canvas-shortcut-panel");
    expect(board).toContain('position="bottom-center"');
    expect(board).toContain("data-canvas-bottom-dock");
  });

  it("implements the documented shortcut behavior and node context menu", async () => { verifyKeyboardCommands(); const board = read('components/canvas/SmartCanvasBoard.tsx'); expect(board).toContain('onDoubleClickCapture={onPaneDoubleClick}'); expect(board).toContain('zoomOnDoubleClick={false}'); for (const kind of ['imageTask','videoTask','audioTask','llm']) expect(board).toContain('data-canvas-create-kind="'+kind+'"'); });

  it("does not auto-fit the first upload added to an initially empty canvas", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");

    expect(board).toContain("const migrateLegacyViewportRef = React.useRef(");
    expect(board).toContain("initial.nodes.length > 0");
    expect(board).toContain("if (!migrateLegacyViewportRef.current) return");
    expect(board).toContain("migrateLegacyViewportRef.current = false");
    expect(board).not.toContain("fitView={fitInitialViewRef.current}");
    expect(board).not.toContain("fitView={document.nodes.length > 0");
  });

  it("supports selected workflow transfer, append import, and workflow library storage", () => {
    const editor = read("components/canvas/CanvasEditorPage.tsx");
    expect(editor).toContain("selectCanvasSubgraph");
    expect(editor).toContain("appendCanvasDocument");
    expect(editor).toContain("CanvasWorkflowPanel");
    expect(editor).toContain("createWorkflowArchive(exported, setWorkflowProgress)");
    expect(editor).toContain("readWorkflowFile(file, uploadCanvasMedia, setWorkflowProgress)");
    expect(fs.existsSync(path.join(root, "app/api/canvas/library/workflows/route.ts"))).toBe(true);
    const workflow = read("components/canvas/CanvasWorkflowPanel.tsx");
    expect(workflow).toContain("工作流");
    expect(workflow).toContain('onExport("selected", "library")');
  });

  it("provides group batch actions and complete folder management", () => {
    const node = read("components/canvas/CanvasNodeCard.tsx");
    for (const label of ["折叠", "展开", "整理", "整组预览", "宫格拼接", "批量下载", "解散分组"]) expect(node).toContain(label);
    const library = read("components/canvas/CanvasLibraryPanel.tsx");
    expect(library).toContain("<CanvasPersonalLibrary");
    const personalLibrary = read("components/canvas/CanvasPersonalLibrary.tsx");
    expect(personalLibrary).toContain('operation: "rename", type: target.type');
    expect(personalLibrary).toContain('operation: "delete", type: target.type');
  });
});
