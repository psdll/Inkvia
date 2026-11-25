import { afterEach, describe, expect, it, vi } from "vitest";
import { removeSelection } from "@/lib/canvas/graph";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("canvas audio waveform", () => {
  it("reduces decoded channels to 80 normalized integer peaks", async () => {
    const module = await import("@/lib/canvas/audio-waveform").catch(() => ({}));
    const sampleAudioChannels = (module as any).sampleAudioChannels;

    expect(sampleAudioChannels).toBeTypeOf("function");

    const waveform = sampleAudioChannels([
      Float32Array.from({ length: 800 }, (_, index) => (index % 10) / 10),
      Float32Array.from({ length: 800 }, (_, index) => ((index + 5) % 10) / 20),
    ], 8);

    expect(waveform.waveformPeaks).toHaveLength(80);
    expect(waveform.waveformPeaks.every((peak: number) => Number.isInteger(peak) && peak >= 0 && peak <= 100)).toBe(true);
    expect(Math.max(...waveform.waveformPeaks)).toBe(100);
    expect(waveform.durationSeconds).toBe(8);
  });

  it("keeps silent audio visible without inventing amplitude changes", async () => {
    const module = await import("@/lib/canvas/audio-waveform").catch(() => ({}));
    const sampleAudioChannels = (module as any).sampleAudioChannels;

    expect(sampleAudioChannels).toBeTypeOf("function");

    const waveform = sampleAudioChannels([new Float32Array(160)], 2);

    expect(new Set(waveform.waveformPeaks)).toEqual(new Set([4]));
  });

  it("formats time and emits a compact SVG path", async () => {
    const module = await import("@/lib/canvas/audio-waveform").catch(() => ({}));
    const formatCanvasAudioTime = (module as any).formatCanvasAudioTime;
    const createCanvasWaveformPath = (module as any).createCanvasWaveformPath;

    expect(formatCanvasAudioTime).toBeTypeOf("function");
    expect(createCanvasWaveformPath).toBeTypeOf("function");
    expect(formatCanvasAudioTime(0)).toBe("00:00");
    expect(formatCanvasAudioTime(70.9)).toBe("01:10");
    expect(formatCanvasAudioTime(Number.NaN)).toBe("00:00");

    const path = createCanvasWaveformPath([20, 100], 20, 20);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).toContain("V");
  });

  it("decodes a selected file and closes the temporary audio context", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const decodeAudioData = vi.fn().mockResolvedValue({
      duration: 3,
      numberOfChannels: 1,
      getChannelData: () => Float32Array.from({ length: 80 }, (_, index) => index / 80),
    });
    vi.stubGlobal("AudioContext", class {
      decodeAudioData = decodeAudioData;
      close = close;
    });
    const module = await import("@/lib/canvas/audio-waveform").catch(() => ({}));
    const analyzeAudioFile = (module as any).analyzeAudioFile;

    expect(analyzeAudioFile).toBeTypeOf("function");
    const file = { arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) } as unknown as File;

    const waveform = await analyzeAudioFile(file);

    expect(decodeAudioData).toHaveBeenCalledOnce();
    expect(waveform.waveformPeaks).toHaveLength(80);
    expect(waveform.durationSeconds).toBe(3);
    expect(close).toHaveBeenCalledOnce();
  });

  it("reuses a registered upload analysis for the persisted URL", async () => {
    const module = await import("@/lib/canvas/audio-waveform").catch(() => ({}));
    const registerAudioWaveformPromise = (module as any).registerAudioWaveformPromise;
    const analyzeAudioUrlCached = (module as any).analyzeAudioUrlCached;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(registerAudioWaveformPromise).toBeTypeOf("function");
    expect(analyzeAudioUrlCached).toBeTypeOf("function");
    const expected = { waveformPeaks: Array(80).fill(25), durationSeconds: 5 };
    registerAudioWaveformPromise("/uploads/audio.mp3", Promise.resolve(expected));

    await expect(analyzeAudioUrlCached("/uploads/audio.mp3")).resolves.toEqual(expected);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("hydrates only the requested audio node without mutating the document", async () => {
    const module = await import("@/lib/canvas/audio-waveform").catch(() => ({}));
    const hydrateCanvasAudioNode = (module as any).hydrateCanvasAudioNode;
    expect(hydrateCanvasAudioNode).toBeTypeOf("function");
    const document = {
      schemaVersion: 2,
      mode: "smart",
      nodes: [
        { id: "audio-a", type: "audio", position: { x: 0, y: 0 }, data: { kind: "audio", url: "/a.mp3" } },
        { id: "image-a", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/a.png" } },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { snapToGrid: false, gridSize: 20 },
    };
    const waveform = { waveformPeaks: Array(80).fill(30), durationSeconds: 9 };

    const next = hydrateCanvasAudioNode(document, "audio-a", waveform);

    expect(next).not.toBe(document);
    expect(next.nodes[0].data).toMatchObject(waveform);
    expect(next.nodes[1]).toBe(document.nodes[1]);
    expect((document.nodes[0].data as any).waveformPeaks).toBeUndefined();
  });

  it("deletes persisted waveform metadata together with its audio node", () => {
    const source = {
      schemaVersion: 2 as const,
      mode: "smart" as const,
      nodes: [{
        id: "audio-a",
        type: "audio" as const,
        position: { x: 0, y: 0 },
        data: { kind: "audio" as const, url: "/a.mp3", waveformPeaks: Array(80).fill(30), durationSeconds: 9 },
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { snapToGrid: false, gridSize: 20 },
    };

    const next = removeSelection(source, ["audio-a"]);

    expect(next.nodes).toHaveLength(0);
    expect(JSON.stringify(next)).not.toContain("waveformPeaks");
  });
});
