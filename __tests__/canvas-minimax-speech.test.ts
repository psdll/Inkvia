import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";
import { parseCanvasDocumentV2 } from "@/lib/canvas/document";

describe("canvas MiniMax speech node", () => {
  it("persists the audio task settings in the canvas document", () => {
    const document = parseCanvasDocumentV2({
      schemaVersion: 2,
      mode: "smart",
      nodes: [{
        id: "audio-task-1",
        type: "audioTask",
        position: { x: 0, y: 0 },
        data: {
          kind: "audioTask",
          model: "speech-2.8-hd",
          prompt: "你好",
          voiceId: "female-shaonv",
          voiceName: "少女音色",
          speed: 1,
          pitch: 0,
          volume: 1,
          modifyPitch: 0,
          modifyIntensity: 0,
          modifyTimbre: 0,
          soundEffect: "",
          emotion: "happy",
          status: "idle",
        },
        width: 300,
        height: 120,
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { snapToGrid: false, gridSize: 20 },
    });

    expect(document.nodes[0].data).toMatchObject({
      kind: "audioTask",
      voiceId: "female-shaonv",
      speed: 1,
      soundEffect: "",
      emotion: "happy",
    });
  });

  it("exposes the speech controls and the audio generation route", () => {
    const card = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
    const runner = readFileSync("components/canvas/run-node.ts", "utf8");
    const voiceDialog = readFileSync("components/canvas/CanvasMiniMaxVoiceDialog.tsx", "utf8");
    const speechModels = readFileSync("lib/minimax-speech-models.ts", "utf8");
    const cloneRoute = readFileSync(
      "app/api/canvas/speech/clone/route.ts",
      "utf8",
    );
    const cloneDialog = readFileSync(
      "components/canvas/CanvasMiniMaxVoiceCloneDialog.tsx",
      "utf8",
    );
    const editor = readFileSync("components/canvas/CanvasEditorPage.tsx", "utf8");
    const voiceQuery = readFileSync(
      "components/canvas/use-canvas-minimax-voices.ts",
      "utf8",
    );
    const filterDialog = readFileSync(
      "components/canvas/CanvasMiniMaxVoiceFilterDialog.tsx",
      "utf8",
    );
    const globals = readFileSync("app/globals.css", "utf8");

    expect(card).toContain("{textLength}/10000");
    expect(voiceDialog).toContain("20条/页");
    expect(voiceDialog).toContain("音色库");
    expect(voiceDialog).not.toContain('title="首次试听');
    expect(voiceDialog).not.toContain("删除保存文件后");
    expect(voiceDialog).toContain("VOICE_NOTICE_DURATION_MS = 3_000");
    expect(voiceDialog).toContain("canvas-minimax-voice-success-toast");
    expect(globals).toContain(".canvas-minimax-voice-success-toast");
    expect(voiceDialog).toContain('LANGUAGE_LABELS[voice.language || "multi"]');
    expect(voiceDialog).not.toContain("{voice.language ? (");
    expect(voiceDialog).toContain("克隆新音色");
    expect(voiceDialog).toContain("/api/canvas/speech/preview");
    expect(cloneDialog).toContain("/api/canvas/speech/clone");
    for (const label of [
      "朗读一段文字，即可克隆你的专属声音",
      "文本刷新",
      "开始录音",
      "声音授权规则",
      "生成音色",
    ]) {
      expect(cloneDialog).toContain(label);
    }
    expect(cloneDialog).toContain("usePcmWavRecorder");
    expect(cloneDialog).toContain('type="file"');
    expect(cloneDialog).not.toContain("previewText");
    expect(cloneRoute).toContain("createMiniMaxCloneVoiceId");
    expect(cloneRoute).toContain("inspectPcmWav");
    expect(cloneRoute).not.toContain("saveMiniMaxVoicePreviewFromRemote");
    expect(editor).toContain("useCanvasMiniMaxVoiceWarmup");
    expect(voiceQuery).toContain("prefetchQuery");
    expect(voiceQuery).toContain("MINIMAX_VERIFIED_VOICE_SEED");
    expect(voiceQuery).not.toContain("sessionStorage");
    expect(voiceDialog).not.toContain("正在加载音色");
    expect(voiceDialog).not.toContain('cache: "no-store"');
    for (const label of [
      "音色选择",
      "音色库",
      "我的音色",
      "收藏音色",
      "克隆新音色",
      "搜索音色库",
      "筛选",
      "复制 Voice ID",
      "暂无可用音色，快去克隆你的新音色吧～",
      "20条/页",
    ]) {
      expect(voiceDialog).toContain(label);
    }
    for (const label of [
      "语言",
      "口音",
      "性别",
      "年龄",
      "青年",
      "成年",
      "儿童",
      "老年",
      "重置参数",
    ]) {
      expect(filterDialog).toContain(label);
    }
    expect(filterDialog).not.toContain("<select");
    expect(voiceDialog).toContain("showLeading={false}");
    expect(voiceDialog).toContain("showOptionLeading={false}");
    expect(voiceDialog).toContain("menuWidth={108}");
    expect(voiceDialog).toContain("optionHeight={34}");
    expect(voiceDialog).toContain("canvas-minimax-voice-page-size-menu");
    expect(globals).toContain(".canvas-minimax-voice-page-size-menu");
    expect(globals).toContain(".canvas-minimax-voice-dialog");
    expect(globals).toContain("width: min(800px");
    expect(globals).toContain("height: min(616px");
    expect(globals).toContain("backdrop-filter: blur(2px)");
    expect(board).toContain('addNode("audioTask"');
    expect(runner).toContain('fetch("/api/canvas/generate-audio"');
  });
});
