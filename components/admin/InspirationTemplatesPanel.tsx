"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";

import { sortAspectRatioOptions } from "@/lib/aspect-ratio-order";
import { KIE_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_MODEL, NANO_BANANA_21_RATIOS } from "@/lib/nano-banana-21-providers";
import { OPENROUTER_IMAGE_MODELS, getOpenRouterImageParams } from "@/lib/openrouter-image-params";

import { QWEN_IMAGE_3_MODEL_ID, QWEN_IMAGE_3_RATIOS, QWEN_IMAGE_3_RESOLUTIONS } from "@/lib/qwen-image-3-models";

import { REAPI_GPT_IMAGE_25_RATIOS } from "@/lib/reapi-gpt-image-25";
import { AICOMING_GPT_IMAGE_25_RATIOS } from "@/lib/aicoming-gpt-image-25";
import { GPT_IMAGE_25_RATIOS } from "@/lib/apimart-gpt-image-25";
import { APIMART_GPT_IMAGE_26_MODEL_ID } from "@/lib/apimart-image-models";

import * as React from "react";
import { fetchJsonOnce } from "@/lib/client/inflight-json";
import { ChevronDown, ChevronUp, Download, Image as ImageIcon, RefreshCw, Trash2, Upload, Video, X } from "lucide-react";
import { normalizeMediaUrl } from "@/lib/media-url";
import { InspirationDetailFullscreen, type InspirationDetailViewItem } from "@/components/templates/inspiration-detail-fullscreen";
import {
  getVideoDisplayResolution,
  getVideoDisplaySpec,
  type VideoModelCapabilityPayload,
} from "@/lib/video-resolution-visibility";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaImage } from "@/components/ui/media-image";
import {
  AICOMING_HAIYA_GPT_IMAGE_2_RATIOS,
  REAPI_GPT_IMAGE_2_RATIOS,
  isGptImage2OfficialProviderModel,
  isGptImage2OfficialSizeComboValid,
} from "@/lib/gpt-image-2-official";
import {
  TUZI_GPT_IMAGE_2_ASPECT_RATIOS,
  TUZI_GPT_IMAGE_2_RESOLUTIONS,
  isTuziGptImage2Model,
  isTuziGptImage2SizeComboValid,
} from "@/lib/tuzi-image-params";

type ToolType = "face" | "image" | "video";
type MediaType = "image" | "video";

type InspirationTemplateItem = {
  id: number;
  title: string;
  category?: string | null;
  prompt: string;
  description: string | null;
  toolType: ToolType;
  mediaType: MediaType;
  previewImagePath: string | null;
  previewVideoPath: string | null;
  tags: string[];
  createdAt: string;
  sourceLabel?: string | null;
};

type InspirationTemplateDetail = {
  id: number;
  title: string;
  prompt: string;
  description?: string | null;
  toolType?: ToolType;
  mediaType?: MediaType;
  tags?: string[];
  createdAt: string;
  detail: {
    type: string;
    model: string | null;
    params: Record<string, any>;
    inputImages: string[];
    outputPaths: string[];
  };
};

const mediaOptions: Array<{ label: string; value: MediaType }> = [
  { label: "图片", value: "image" },
  { label: "视频", value: "video" }
];

const IMAGE_ASPECT_BY_MODEL: Record<string, string[]> = {
  ...Object.fromEntries(OPENROUTER_IMAGE_MODELS.map(model => [model.id, getOpenRouterImageParams(model.id).aspectRatios.map(item => item.value)])),
  [QWEN_IMAGE_3_MODEL_ID]: QWEN_IMAGE_3_RATIOS,
  "nano-banana-pro": ["auto", "1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3"],
  [KIE_NANO_BANANA_21_MODEL]: NANO_BANANA_21_RATIOS,
  [APIMART_NANO_BANANA_21_MODEL]: NANO_BANANA_21_RATIOS,
  "nano-banana-2": ["auto", "1:1", "4:1", "8:1", "3:4", "1:4", "4:3", "16:9", "9:16", "3:2", "2:3"],
  "gpt-image-2": ["auto", "1:1", "9:16", "16:9", "4:3", "3:4"],
  "gpt-image-2.5-apimart": [...GPT_IMAGE_25_RATIOS],
  [APIMART_GPT_IMAGE_26_MODEL_ID]: [...GPT_IMAGE_25_RATIOS],
  "gpt-image-2.5-reapi": [...REAPI_GPT_IMAGE_25_RATIOS],
  "gpt-image-2.5-aicoming-haiya": [...AICOMING_GPT_IMAGE_25_RATIOS],
  "gpt-image-2-apimart": ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"],
  "gpt-image-2-jiekou": ["auto", "1:1", "2:3", "3:2", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21", "1:3", "3:1", "2:1", "1:2"],
  "gpt-image-2-official-reapi": [...REAPI_GPT_IMAGE_2_RATIOS],
  "gpt-image-2-aicoming-haiya": [...AICOMING_HAIYA_GPT_IMAGE_2_RATIOS],
  "qwen-image-global-2.1": ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
  "gpt-image-2-tuzi": [...TUZI_GPT_IMAGE_2_ASPECT_RATIOS],
  "image 2": ["auto", "1:1", "9:16", "16:9", "4:3", "3:4", "custom"],
  "doubao-seedream-5.0-pro": ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9"],
  "doubao-seedream-5.0-lite": ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9"],
  "doubao-seedream-4.5": ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9"],
  "doubao-seedream-4.0": ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9"]
};

const IMAGE_RESOLUTION_BY_MODEL: Record<string, string[]> = {
  [KIE_NANO_BANANA_21_MODEL]: ["1K", "2K", "4K"],
  [APIMART_NANO_BANANA_21_MODEL]: ["1K", "2K", "4K"],
  ...Object.fromEntries(OPENROUTER_IMAGE_MODELS.map(model => [model.id, getOpenRouterImageParams(model.id).resolutions.map(item => item.value)])),
  [QWEN_IMAGE_3_MODEL_ID]: QWEN_IMAGE_3_RESOLUTIONS,
  "nano-banana-pro": ["1K", "2K", "4K"],
  "nano-banana-2": ["1K", "2K", "4K"],
  "gpt-image-2": ["1K", "2K", "4K"],
  "gpt-image-2.5-apimart": ["1K", "2K", "4K"],
  [APIMART_GPT_IMAGE_26_MODEL_ID]: ["1K", "2K", "4K"],
  "gpt-image-2.5-reapi": ["1K", "2K", "4K"],
  "gpt-image-2.5-aicoming-haiya": ["1K", "2K", "4K"],
  "gpt-image-2-apimart": ["1K", "2K", "4K"],
  "gpt-image-2-jiekou": ["1K", "2K", "4K"],
  "gpt-image-2-official-reapi": ["1K", "2K", "4K"],
  "gpt-image-2-aicoming-haiya": ["1K", "2K", "4K"],
  "qwen-image-global-2.1": ["1K", "2K", "4K"],
  "gpt-image-2-tuzi": [...TUZI_GPT_IMAGE_2_RESOLUTIONS],
  "image 2": ["1K", "2K", "4K"],
  "doubao-seedream-5.0-pro": ["1K", "2K"],
  "doubao-seedream-5.0-lite": ["2K", "3K"],
  "doubao-seedream-4.5": ["2K", "4K"],
  "doubao-seedream-4.0": ["1K", "2K", "4K"]
};

function LocalFilePreview({ file }: { file: File }) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  if (!url) return null;
  if (String(file.type || "").startsWith("video/")) {
    return <video src={url} className="h-full w-full object-cover" muted playsInline />;
  }
  if (String(file.type || "").startsWith("image/")) {
    return <img src={url} alt={file.name} className="h-full w-full object-cover" />;
  }
  return <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--app-muted)]"><UiText id="admin.m39932f24fe11" /></div>;
}

function mergeUniqueFiles(prev: File[], next: File[]) {
  const seen = new Set(prev.map((f) => `${f.name}_${f.size}_${f.lastModified}_${f.type}`));
  const merged = [...prev];
  for (const file of next) {
    const key = `${file.name}_${file.size}_${file.lastModified}_${file.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(file);
  }
  return merged;
}

export default function InspirationTemplatesPanel() {
  const { label: tLabel } = useUiLocale();
  const { error: uiError } = useUiLocale();
  const [category, setCategory] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [model, setModel] = React.useState("");
  const [paramsJson, setParamsJson] = React.useState("");
  const [paramsJsonEdited, setParamsJsonEdited] = React.useState(false);
  const [useBuiltinModel, setUseBuiltinModel] = React.useState(true);
  const [builtinModel, setBuiltinModel] = React.useState("nano-banana-pro");
  const [aspectRatio, setAspectRatio] = React.useState("1:1");
  const [resolution, setResolution] = React.useState("2K");
  const [imageCount, setImageCount] = React.useState("1");
  const [seedreamOutputMode, setSeedreamOutputMode] = React.useState<"single" | "group">("single");
  const [seedreamOutputCount, setSeedreamOutputCount] = React.useState("4");
  const [seedreamWebSearch, setSeedreamWebSearch] = React.useState<"off" | "on">("off");
  const [videoDuration, setVideoDuration] = React.useState("5");
  const [videoInputMode, setVideoInputMode] = React.useState("text_to_video");
  const [mediaType, setMediaType] = React.useState<MediaType>("image");
  const toolType: ToolType = mediaType === "video" ? "video" : "image";
  const [tags, setTags] = React.useState("");
  const [previewFile, setPreviewFile] = React.useState<File | null>(null);
  const [inputFiles, setInputFiles] = React.useState<File[]>([]);
  const [outputFiles, setOutputFiles] = React.useState<File[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [importingPackage, setImportingPackage] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<InspirationTemplateItem[]>([]);
  const [uploadFormExpanded, setUploadFormExpanded] = React.useState(true);
  const [recentUploadsExpanded, setRecentUploadsExpanded] = React.useState(false);
  const [selectedExportIds, setSelectedExportIds] = React.useState<number[]>([]);
  const [exportingBatch, setExportingBatch] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState<number>(0);
  const [importProgress, setImportProgress] = React.useState<number>(0);
  const importProgressTimerRef = React.useRef<number | null>(null);
  const exportProgressTimerRef = React.useRef<number | null>(null);
  const [deletingBatch, setDeletingBatch] = React.useState(false);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<number | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailItem, setDetailItem] = React.useState<InspirationTemplateDetail | null>(null);
  const [toolboxModelOptions, setToolboxModelOptions] = React.useState<Record<ToolType, Array<{ label: string; value: string }>>>(() => ({
    face: [],
    image: [],
    video: [],
  }));
  const [videoCapabilityPayload, setVideoCapabilityPayload] = React.useState<VideoModelCapabilityPayload[]>([]);
  const [videoCapabilityStatus, setVideoCapabilityStatus] = React.useState<"pending" | "loaded" | "failed">("pending");

  React.useEffect(() => {
    let cancelled = false;
    Promise.all((["image", "video"] as const).map(async (category) => {
      const { ok, json } = await fetchJsonOnce<any>(`/api/toolbox/models?category=${category}`);
      if (!ok || json?.success !== true || !Array.isArray(json.models)) {
        throw new Error("toolbox models unavailable");
      }
      return [category, json.models] as const;
    }))
      .then((entries) => {
        if (!cancelled) {
          const payload = Object.fromEntries(entries) as Record<ToolType, Array<{ id: string; label: string }>>;
          setToolboxModelOptions(Object.fromEntries(entries.map(([category, models]) => [
            category,
            models.map((item: any) => ({ label: String(item.label || item.id), value: String(item.id) })),
          ])) as Record<ToolType, Array<{ label: string; value: string }>>);
          setVideoCapabilityPayload(payload.video);
          setVideoCapabilityStatus("loaded");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setToolboxModelOptions({ face: [], image: [], video: [] });
          setVideoCapabilityPayload([]);
          setVideoCapabilityStatus("failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadItems = React.useCallback(async () => {
    setLoading(true);
    try {
      const all: InspirationTemplateItem[] = [];
      const pageTake = 60;
      let skip = 0;
      let hasMore = true;
      while (hasMore) {
        const { ok, json } = await fetchJsonOnce<any>(`/api/admin/settings/inspiration-templates?take=${pageTake}&skip=${skip}`)
          .catch(() => ({ ok: false, json: null }));
        if (!ok) {
          setItems([]);
          return;
        }
        const list = Array.isArray(json?.data) ? (json.data as InspirationTemplateItem[]) : [];
        all.push(...list);
        if (list.length < pageTake) hasMore = false;
        else skip += pageTake;
      }
      try { window.localStorage.setItem("inspiration_template_cards_invalidated_at_v1", String(Date.now())); } catch {}
      window.dispatchEvent(new Event("inspiration-template-cards:invalidate"));
      setItems(
        all.map((it) => ({
          ...it,
          previewImagePath: it.previewImagePath ? normalizeMediaUrl(it.previewImagePath) : null,
          previewVideoPath: it.previewVideoPath ? normalizeMediaUrl(it.previewVideoPath) : null
        }))
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadItems();
  }, [loadItems]);

  React.useEffect(() => {
    setSelectedExportIds((prev) => prev.filter((id) => items.some((x) => x.id === id)));
  }, [items]);
  React.useEffect(() => {
    if (!selectedExportIds.length) setConfirmDeleteBatch(false);
  }, [selectedExportIds.length]);

  const clearProgressTimer = React.useCallback((kind: "import" | "export") => {
    if (kind === "import" && importProgressTimerRef.current !== null) {
      window.clearInterval(importProgressTimerRef.current);
      importProgressTimerRef.current = null;
      return;
    }
    if (kind === "export" && exportProgressTimerRef.current !== null) {
      window.clearInterval(exportProgressTimerRef.current);
      exportProgressTimerRef.current = null;
    }
  }, []);

  const startFakeProgress = React.useCallback((kind: "import" | "export") => {
    clearProgressTimer(kind);
    const tick = () => {
      const bump = (v: number) => {
        if (v >= 90) return v;
        const step = Math.max(1, Math.round((90 - v) / 12));
        return Math.min(90, v + step);
      };
      if (kind === "import") setImportProgress((prev) => bump(prev));
      else setExportProgress((prev) => bump(prev));
    };
    const timer = window.setInterval(tick, 180);
    if (kind === "import") importProgressTimerRef.current = timer;
    else exportProgressTimerRef.current = timer;
  }, [clearProgressTimer]);

  React.useEffect(() => {
    return () => {
      clearProgressTimer("import");
      clearProgressTimer("export");
    };
  }, [clearProgressTimer]);

  const allVisibleIds = React.useMemo(() => items.map((x) => x.id), [items]);
  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedExportIds.includes(id));
  const collapseRecentUploads = React.useCallback(() => {
    setRecentUploadsExpanded(false);
  }, []);
  const refreshRecentUploads = React.useCallback(async () => {
    await loadItems();
    collapseRecentUploads();
  }, [collapseRecentUploads, loadItems]);
  const toggleSelectAllVisible = React.useCallback(() => {
    setSelectedExportIds((prev) => {
      if (!allVisibleIds.length) return prev;
      if (allVisibleIds.every((id) => prev.includes(id))) {
        return prev.filter((id) => !allVisibleIds.includes(id));
      }
      return Array.from(new Set([...prev, ...allVisibleIds]));
    });
  }, [allVisibleIds]);
  const invertSelectVisible = React.useCallback(() => {
    setSelectedExportIds((prev) => {
      const visibleSet = new Set(allVisibleIds);
      const next: number[] = [];
      for (const id of prev) {
        if (!visibleSet.has(id)) next.push(id);
      }
      for (const id of allVisibleIds) {
        if (!prev.includes(id)) next.push(id);
      }
      return next;
    });
  }, [allVisibleIds]);

  const builtInModelOptions = React.useMemo(() => {
    return toolboxModelOptions[toolType];
  }, [toolType, toolboxModelOptions]);

  React.useEffect(() => {
    const first = builtInModelOptions[0]?.value || "";
    if (!builtInModelOptions.some((opt) => opt.value === builtinModel)) {
      setBuiltinModel(first);
    }
  }, [builtinModel, builtInModelOptions]);

  const selectedModel = React.useMemo(() => {
    if (useBuiltinModel) return builtinModel;
    return String(model || "").trim();
  }, [builtinModel, model, useBuiltinModel]);

  const selectedImageAspectOptions = React.useMemo(
    () => {
      const options = IMAGE_ASPECT_BY_MODEL[selectedModel] || ["auto", "1:1", "3:4", "4:3", "16:9", "9:16"];
      if (isTuziGptImage2Model(selectedModel)) {
        return options.filter((value) => isTuziGptImage2SizeComboValid(value, resolution));
      }
      if (!isGptImage2OfficialProviderModel(selectedModel)) return options;
      return options.filter((value) => isGptImage2OfficialSizeComboValid(selectedModel, value, resolution));
    },
    [resolution, selectedModel]
  );
  const selectedImageResolutionOptions = React.useMemo(
    () => {
      const options = IMAGE_RESOLUTION_BY_MODEL[selectedModel] || ["1K", "2K", "4K"];
      if (isTuziGptImage2Model(selectedModel)) {
        return options.filter((value) => isTuziGptImage2SizeComboValid(aspectRatio, value));
      }
      if (!isGptImage2OfficialProviderModel(selectedModel)) return options;
      return options.filter((value) => isGptImage2OfficialSizeComboValid(selectedModel, aspectRatio, value));
    },
    [aspectRatio, selectedModel]
  );
  const selectedVideoSpec = React.useMemo(
    () => getVideoDisplaySpec(selectedModel, videoCapabilityPayload),
    [selectedModel, videoCapabilityPayload],
  );
  const selectedVideoResolutionOptions = React.useMemo(
    () => videoCapabilityPayload.some((model) => String(model.id || "") === selectedModel)
      ? selectedVideoSpec.supportedResolutions.map((x) => String(x))
      : [],
    [selectedModel, selectedVideoSpec, videoCapabilityPayload]
  );
  const effectiveVideoResolution = getVideoDisplayResolution(selectedVideoSpec, resolution);
  const selectedVideoInputModeOptions = React.useMemo(
    () => videoCapabilityPayload.some((model) => String(model.id || "") === selectedModel)
      ? selectedVideoSpec.supportedInputModes.map((x) => String(x))
      : [],
    [selectedModel, selectedVideoSpec, videoCapabilityPayload]
  );
  const selectedVideoDurationOptions = React.useMemo(() => {
    const candidate = [4, 5, 6, 8, 10, 12, 15];
    const min = Number(selectedVideoSpec.minDurationSeconds || 4);
    const max = Number(selectedVideoSpec.maxDurationSeconds || 15);
    const filtered = candidate.filter((x) => x >= min && x <= max);
    return filtered.length ? filtered.map((x) => String(x)) : [String(min)];
  }, [selectedVideoSpec]);

  React.useEffect(() => {
    if (toolType !== "image") return;
    if (!selectedImageAspectOptions.includes(aspectRatio)) setAspectRatio(selectedImageAspectOptions[0] || "1:1");
    if (!selectedImageResolutionOptions.includes(resolution)) setResolution(selectedImageResolutionOptions[0] || "2K");
  }, [aspectRatio, resolution, selectedImageAspectOptions, selectedImageResolutionOptions, toolType]);

  React.useEffect(() => {
    if (toolType !== "video") return;
    if (videoCapabilityStatus === "loaded" && !selectedVideoResolutionOptions.includes(resolution)) {
      setResolution(selectedVideoResolutionOptions[0] || "720p");
    }
    if (!selectedVideoInputModeOptions.includes(videoInputMode)) setVideoInputMode(selectedVideoInputModeOptions[0] || "text_to_video");
    const min = Number(selectedVideoSpec.minDurationSeconds || 4);
    const max = Number(selectedVideoSpec.maxDurationSeconds || 15);
    const current = Number(videoDuration || 0);
    if (!Number.isFinite(current) || current < min || current > max) setVideoDuration(String(min));
  }, [
    resolution,
    selectedVideoInputModeOptions,
    selectedVideoResolutionOptions,
    selectedVideoSpec,
    toolType,
    videoCapabilityStatus,
    videoDuration,
    videoInputMode
  ]);

  const autoParamsJson = React.useMemo(() => {
    const base: Record<string, any> = {};
    if (selectedModel) base.model = selectedModel;
    if (toolType === "image") {
      base.aspectRatio = aspectRatio;
      base.resolution = resolution;
      if (imageCount) base.imageCount = Number(imageCount);
      if (selectedModel.includes("seedream")) {
        base.seedream = {
          outputMode: seedreamOutputMode,
          outputCount: Number(seedreamOutputCount || 4),
          webSearch: seedreamWebSearch === "on"
        };
      }
    } else if (toolType === "video") {
      base.duration = Number(videoDuration || 5);
      base.resolution = effectiveVideoResolution;
      base.inputMode = videoInputMode;
    }
    return JSON.stringify(base);
  }, [
    aspectRatio,
    imageCount,
    effectiveVideoResolution,
    resolution,
    seedreamOutputCount,
    seedreamOutputMode,
    seedreamWebSearch,
    selectedModel,
    toolType,
    videoDuration,
    videoInputMode
  ]);

  React.useEffect(() => {
    if (paramsJsonEdited) return;
    setParamsJson(autoParamsJson);
  }, [autoParamsJson, paramsJsonEdited]);

  const changeMediaType = (next: MediaType) => {
    if (next === mediaType) return;
    setMediaType(next);
    setUseBuiltinModel(true);
    setModel("");
    setBuiltinModel(toolboxModelOptions[next][0]?.value || "");
    // A custom JSON/model for the previous medium must not override the new defaults.
    setParamsJsonEdited(false);
  };

  const pickFiles = React.useCallback((files: FileList | null, target: "input" | "output" | "preview") => {
    const list = Array.from(files || []);
    if (target === "input") {
      setInputFiles((prev) => mergeUniqueFiles(prev, list));
      return;
    }
    if (target === "output") {
      setOutputFiles((prev) => mergeUniqueFiles(prev, list));
      return;
    }
    setPreviewFile(list[0] || null);
  }, []);

  const handleDropFiles = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>, target: "input" | "output" | "preview") => {
      e.preventDefault();
      e.stopPropagation();
      pickFiles(e.dataTransfer?.files || null, target);
    },
    [pickFiles]
  );

  const removeInputAt = React.useCallback((idx: number) => {
    setInputFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const removeOutputAt = React.useCallback((idx: number) => {
    setOutputFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("title", title);
      fd.set("category", category);
      fd.set("prompt", prompt);
      fd.set("description", description);
      fd.set("toolType", toolType);
      fd.set("mediaType", mediaType);
      fd.set("tags", tags);
      fd.set("model", selectedModel);
      fd.set("paramsJson", paramsJson);
      if (previewFile) {
        if (mediaType === "video") fd.set("previewVideo", previewFile);
        else fd.set("previewImage", previewFile);
      }
      inputFiles.forEach((f) => fd.append("inputFiles", f));
      outputFiles.forEach((f) => fd.append("outputFiles", f));
      const res = await fetch("/api/admin/settings/inspiration-templates", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.success) {
        setMessage(String(json?.error || "上传失败"));
        return;
      }
      setTitle("");
      setPrompt("");
      setDescription("");
      setModel("");
      setParamsJson("");
      setParamsJsonEdited(false);
      setUseBuiltinModel(true);
      setBuiltinModel("nano-banana-pro");
      setAspectRatio("1:1");
      setResolution("2K");
      setImageCount("1");
      setSeedreamOutputMode("single");
      setSeedreamOutputCount("4");
      setSeedreamWebSearch("off");
      setVideoDuration("5");
      setVideoInputMode("text_to_video");
      setTags("");
      setPreviewFile(null);
      setInputFiles([]);
      setOutputFiles([]);
      setMessage("模板已上传");
      await refreshRecentUploads();
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (id: number) => {
    setMessage(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/settings/inspiration-templates/${id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.success) {
        setMessage(String(json?.error || "删除失败"));
        return;
      }
      setMessage("模板已删除（本地文件已同步删除）");
      setConfirmDeleteId(null);
      await loadItems();
    } finally {
      setDeletingId(null);
    }
  };

  const exportItem = React.useCallback(async (id: number) => {
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/settings/inspiration-templates/${id}/export`, { method: "GET" });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as any;
        setMessage(String(json?.error || "导出失败"));
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const fileName = match?.[1] ? decodeURIComponent(match[1]) : `template_${id}.template.zip`;
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      setMessage(`模板 #${id} 已导出`);
    } catch {
      setMessage("导出失败");
    }
  }, []);

  const importPackage = React.useCallback(async (file: File | null) => {
    if (!file) return;
    setMessage(null);
    setImportingPackage(true);
    setImportProgress(0);
    startFakeProgress("import");
    try {
      const fd = new FormData();
      fd.set("package", file);
      const xhrResult = await new Promise<{ ok: boolean; status: number; json: any }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/admin/settings/inspiration-templates/import", true);
        xhr.withCredentials = true;
        xhr.responseType = "text";
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable || e.total <= 0) return;
          setImportProgress((prev) => Math.max(prev, Math.max(1, Math.min(95, Math.round((e.loaded / e.total) * 100)))));
        };
        xhr.onload = () => {
          let json: any = null;
          try {
            json = JSON.parse(String(xhr.response || "{}"));
          } catch {
            json = null;
          }
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            json
          });
        };
        xhr.onerror = () => reject(new Error("网络错误"));
        xhr.send(fd);
      });
      setImportProgress(100);
      if (!xhrResult.ok || !xhrResult.json?.success) {
        setMessage(String(xhrResult.json?.error || "导入失败"));
        return;
      }
      if (Number(xhrResult.json?.data?.importedCount || 0) > 1) {
        setMessage(`已批量导入 ${xhrResult.json.data.importedCount} 个模板`);
      } else {
        setMessage(`模板已导入：#${xhrResult.json?.data?.id ?? "-"}`);
      }
      await refreshRecentUploads();
    } finally {
      clearProgressTimer("import");
      setImportingPackage(false);
      window.setTimeout(() => setImportProgress(0), 500);
    }
  }, [clearProgressTimer, refreshRecentUploads, startFakeProgress]);

  const exportSelectedBatch = React.useCallback(async () => {
    if (!selectedExportIds.length) {
      setMessage("请先勾选要导出的模板");
      return;
    }
    setMessage(null);
    setExportingBatch(true);
    setExportProgress(0);
    startFakeProgress("export");
    try {
      const xhrResult = await new Promise<{
        ok: boolean;
        status: number;
        blob: Blob | null;
        errorJson: any;
        contentDisposition: string;
        requestedCount: number;
        exportedCount: number;
        failedCount: number;
        failedIds: string;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/admin/settings/inspiration-templates/export", true);
        xhr.withCredentials = true;
        xhr.responseType = "blob";
        xhr.setRequestHeader("content-type", "application/json");
        xhr.onprogress = (e) => {
          if (!e.lengthComputable || e.total <= 0) return;
          setExportProgress((prev) => Math.max(prev, Math.max(1, Math.min(95, Math.round((e.loaded / e.total) * 100)))));
        };
        xhr.onload = async () => {
          const requestedCount = Number(xhr.getResponseHeader("x-export-requested-count") || selectedExportIds.length);
          const exportedCount = Number(xhr.getResponseHeader("x-exported-count") || 0);
          const failedCount = Number(xhr.getResponseHeader("x-export-failed-count") || 0);
          const failedIds = String(xhr.getResponseHeader("x-export-failed-ids") || "");
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({
              ok: true,
              status: xhr.status,
              blob: xhr.response instanceof Blob ? xhr.response : null,
              errorJson: null,
              contentDisposition: String(xhr.getResponseHeader("content-disposition") || ""),
              requestedCount,
              exportedCount,
              failedCount,
              failedIds
            });
            return;
          }
          let errorJson: any = null;
          try {
            const text = await (xhr.response as Blob).text();
            errorJson = JSON.parse(text);
          } catch {
            errorJson = null;
          }
          resolve({
            ok: false,
            status: xhr.status,
            blob: null,
            errorJson,
            contentDisposition: "",
            requestedCount,
            exportedCount,
            failedCount,
            failedIds
          });
        };
        xhr.onerror = () => reject(new Error("网络错误"));
        xhr.send(JSON.stringify({ ids: selectedExportIds }));
      });
      setExportProgress(100);
      if (!xhrResult.ok || !xhrResult.blob) {
        setMessage(String(xhrResult.errorJson?.error || "批量导出失败"));
        return;
      }
      const match = xhrResult.contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
      const fileName = match?.[1] ? decodeURIComponent(match[1]) : "templates-batch.zip";
      const href = URL.createObjectURL(xhrResult.blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      if (xhrResult.failedCount > 0) {
        const failedText = xhrResult.failedIds ? `；失败ID：${xhrResult.failedIds}` : "";
        setMessage(`批量导出完成：请求 ${xhrResult.requestedCount}，成功 ${xhrResult.exportedCount}，失败 ${xhrResult.failedCount}${failedText}`);
      } else {
        setMessage(`已批量导出 ${xhrResult.exportedCount || selectedExportIds.length} 个模板`);
      }
    } catch {
      setMessage("批量导出失败");
    } finally {
      clearProgressTimer("export");
      setExportingBatch(false);
      window.setTimeout(() => setExportProgress(0), 500);
    }
  }, [clearProgressTimer, selectedExportIds, startFakeProgress]);

  const deleteSelectedBatch = React.useCallback(async () => {
    if (!selectedExportIds.length) {
      setMessage("请先勾选要删除的模板");
      return;
    }
    setMessage(null);
    setDeletingBatch(true);
    let successCount = 0;
    let failedCount = 0;
    try {
      for (const id of selectedExportIds) {
        try {
          const res = await fetch(`/api/admin/settings/inspiration-templates/${id}`, { method: "DELETE" });
          const json = (await res.json().catch(() => null)) as any;
          if (res.ok && json?.success) successCount += 1;
          else failedCount += 1;
        } catch {
          failedCount += 1;
        }
      }
      if (failedCount > 0) {
        setMessage(`批量删除完成：成功 ${successCount}，失败 ${failedCount}`);
      } else {
        setMessage(`已批量删除 ${successCount} 个模板`);
      }
      setConfirmDeleteBatch(false);
      setConfirmDeleteId(null);
      await loadItems();
    } finally {
      setDeletingBatch(false);
    }
  }, [loadItems, selectedExportIds]);

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/templates/${id}/detail`, { cache: "no-store" }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as any;
      if (!res || !res.ok || !json?.success || !json?.data) {
        setMessage(String(json?.error || "加载详情失败"));
        return;
      }
      const data = json.data as InspirationTemplateDetail;
      setConfirmDeleteId(null);
      setDetailItem({
        ...data,
        detail: {
          ...data.detail,
          inputImages: Array.isArray(data.detail?.inputImages) ? data.detail.inputImages.map((x) => normalizeMediaUrl(x)).filter(Boolean) : [],
          outputPaths: Array.isArray(data.detail?.outputPaths) ? data.detail.outputPaths.map((x) => normalizeMediaUrl(x)).filter(Boolean) : []
        }
      });
      setDetailOpen(true);
    } finally {
      setDetailLoading(false);
    }
  };

  const detailViewItem = React.useMemo<InspirationDetailViewItem | null>(() => {
    if (!detailItem) return null;
    return detailItem;
  }, [detailItem]);

  return (
    <div className="space-y-4">
      <InspirationDetailFullscreen open={detailOpen} item={detailViewItem} onClose={() => setDetailOpen(false)} />
      <form onSubmit={submit} className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
        <div className={uploadFormExpanded ? "mb-3 flex flex-wrap items-center justify-between gap-2" : "flex flex-wrap items-center justify-between gap-2"}>
          <div>
            <div className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m55da24dbf2b7" /></div>
            <div className="mt-1 text-[11px] text-[var(--app-muted)]">
              {uploadFormExpanded ? <UiText id="admin.m14ce6d209347" /> : <UiText id="admin.m685064ac5d82" />}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setUploadFormExpanded((v) => !v)}
            aria-expanded={uploadFormExpanded}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] hover:bg-[var(--panel-3)]"
          >
            {uploadFormExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {uploadFormExpanded ? <UiText id="admin.mafd4b783536b" /> : <UiText id="admin.m55da24dbf2b7" />}
          </button>
        </div>
        {uploadFormExpanded ? (
          <>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(160px,0.6fr)]">
          <div className="space-y-1">
            <label htmlFor="inspiration-title" className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.mc3405f8c7d9d" /></label>
            <UiProps ids={{"placeholder":["admin.m939d4ac42a5d"]}}><input
              id="inspiration-title"
              placeholder="admin.m939d4ac42a5d"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
            /></UiProps>
          </div>
          <div className="space-y-1">
            <label htmlFor="inspiration-category" className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m515559957fd3" /></label>
            <UiProps ids={{"placeholder":["admin.mc8bc96ae3209"]}}><input id="inspiration-category" value={category} onChange={(e) => setCategory(e.target.value)} list="inspiration-category-options" maxLength={40} placeholder="admin.mc8bc96ae3209" className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20" /></UiProps>
            <datalist id="inspiration-category-options">
              {Array.from(new Set(items.map((item) => item.category).filter((name): name is string => Boolean(name)))).map((name) => <option key={name} value={name} />)}
            </datalist>
          </div>
            </div>
          <div className="space-y-1">
            <label htmlFor="inspiration-prompt" className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m4b47dbae97ba" /></label>
            <UiProps ids={{"placeholder":["admin.m36b7e3b439cd"]}}><textarea
              id="inspiration-prompt"
              placeholder="admin.m36b7e3b439cd"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
              rows={6}
              className="min-h-[152px] max-h-80 resize-y w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
            /></UiProps>
          </div>
          <div className="space-y-1">
            <label htmlFor="inspiration-tags" className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m34544a92724c" /></label>
            <UiProps ids={{"placeholder":["admin.m8844adeb805c"]}}><input
              id="inspiration-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="admin.m8844adeb805c"
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
            /></UiProps>
          </div>
          </div>
          <div className="min-w-0 space-y-4 xl:border-l xl:border-[var(--border)] xl:pl-6">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-[var(--app-fg)]"><UiText id="admin.m5cdc5dc3f5aa" /></span>
              <div className="w-28">
                <FrostedSelect value={mediaType} onChange={(v) => changeMediaType(v as MediaType)} options={mediaOptions} showLeading={false} side="bottom" ariaLabel={tLabel("媒体类型")} compact />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m3ebc24f4c5b0" /></label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => handleDropFiles(e, "output")}
                className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--input-bg)] p-3"
              >
                <input
                  id="inspiration-output-files"
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={(e) => {
                    pickFiles(e.target.files, "output");
                    e.currentTarget.value = "";
                  }}
                  className="hidden"
                />
                <label htmlFor="inspiration-output-files" className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-[11px] text-[var(--app-fg)]"><UiText id="admin.m599738b53157" /></label>
                {outputFiles.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {outputFiles.map((file, idx) => (
                      <div key={`${file.name}_${idx}`} className="relative h-14 w-14 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-bg)]">
                        <LocalFilePreview file={file} />
                        <UiProps ids={{"aria-label":["admin.m5698dac97e5d"]}}><button
                          type="button"
                          onClick={() => removeOutputAt(idx)}
                          className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white"
                          aria-label="admin.m5698dac97e5d"
                        >
                          <X className="h-3 w-3" />
                        </button></UiProps>
                      </div>
                    ))}
                  </div>
                ) : <div className="mt-2 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m10d375125562" /></div>}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2ce6edaf49f2" /></label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => handleDropFiles(e, "input")}
                className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--input-bg)] p-3"
              >
                <input
                  id="inspiration-input-files"
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={(e) => {
                    pickFiles(e.target.files, "input");
                    e.currentTarget.value = "";
                  }}
                  className="hidden"
                />
                <label htmlFor="inspiration-input-files" className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-[11px] text-[var(--app-fg)]"><UiText id="admin.m599738b53157" /></label>
                {inputFiles.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {inputFiles.map((file, idx) => (
                      <div key={`${file.name}_${idx}`} className="relative h-14 w-14 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-bg)]">
                        <LocalFilePreview file={file} />
                        <UiProps ids={{"aria-label":["admin.mc52bf5c08faa"]}}><button
                          type="button"
                          onClick={() => removeInputAt(idx)}
                          className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white"
                          aria-label="admin.mc52bf5c08faa"
                        >
                          <X className="h-3 w-3" />
                        </button></UiProps>
                      </div>
                    ))}
                  </div>
                ) : <div className="mt-2 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m8241b36b28b4" /></div>}
              </div>
            </div>
            <details className="group/preview">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] text-[var(--app-muted)] hover:text-[var(--app-fg)] [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/preview:rotate-180" /><UiText id="admin.m3275b4c91d31" />{previewFile ? <UiText id="admin.m87f4939bc6eb" /> : <UiText id="admin.m3d5c3c3dbaca" />}
              </summary>
              <div className="mt-3 space-y-3">

            <div className="space-y-1">
              <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.me59f576989ab" /></label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => handleDropFiles(e, "preview")}
                className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--input-bg)] p-2"
              >
                <input
                  id="inspiration-preview-file"
                  type="file"
                  accept={mediaType === "video" ? "video/*" : "image/*"}
                  onChange={(e) => {
                    pickFiles(e.target.files, "preview");
                    e.currentTarget.value = "";
                  }}
                  className="hidden"
                />
                <label htmlFor="inspiration-preview-file" className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-[11px] text-[var(--app-fg)]"><UiText id="admin.m599738b53157" /></label>
                {previewFile ? (
                  <div className="mt-2">
                    <div className="relative h-16 w-16 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-bg)]">
                      <LocalFilePreview file={previewFile} />
                      <UiProps ids={{"aria-label":["admin.m2eed51ac0211"]}}><button
                        type="button"
                        onClick={() => setPreviewFile(null)}
                        className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white"
                        aria-label="admin.m2eed51ac0211"
                      >
                        <X className="h-3 w-3" />
                      </button></UiProps>
                    </div>
                  </div>
                ) : <div className="mt-2 text-[11px] text-[var(--app-muted)]"><UiText id="admin.mce2a58ab4ccf" /></div>}
              </div>
            </div>
              </div>
            </details>
          </div>
        </div>
        <details className="group/params mt-5 border-t border-[var(--border)]">
          <summary className="flex cursor-pointer list-none items-center gap-3 py-3 text-[12px] [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--app-muted)] transition-transform group-open/params:rotate-180" />
            <span className="shrink-0 font-medium text-[var(--app-fg)]"><UiText id="admin.m6abcd1436548" /></span>
            <span className="min-w-0 truncate text-[var(--app-muted)]">
              {paramsJsonEdited ? <UiText id="admin.m5100ce4c51a3" /> : [builtInModelOptions.find((option) => option.value === selectedModel)?.label || selectedModel || "未指定模型", toolType === "image" ? `${aspectRatio} · ${resolution} · ${imageCount} 张` : `${videoDuration} 秒 · ${effectiveVideoResolution}`].join(" · ")}
            </span>
          </summary>
          <div className="grid grid-cols-1 gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-3">

          <div className="space-y-1">
            <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m4e799afc8f82" /></label>
            <FrostedSelect
              value={useBuiltinModel ? "builtin" : "custom"}
              onChange={(v) => setUseBuiltinModel(v === "builtin")}
              options={[
                { label: tLabel("内置可选"), value: "builtin" },
                { label: tLabel("自定义"), value: "custom" }
              ]}
              showLeading={false}
              side="bottom"
              ariaLabel={tLabel("模型来源")}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m3463eee7573b" /></label>
            {useBuiltinModel ? (
              <FrostedSelect
                value={builtinModel}
                onChange={setBuiltinModel}
                options={builtInModelOptions}
                showLeading={false}
                side="bottom"
                ariaLabel={tLabel("模型")}
              />
            ) : (
              <UiProps ids={{"placeholder":["admin.m29eaab18a5e9"]}}><input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="admin.m29eaab18a5e9"
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
              /></UiProps>
            )}
          </div>
          {toolType === "image" ? (
            <>
              <div className="space-y-1">
                <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m22aca111bd1d" /></label>
                <FrostedSelect
                  value={aspectRatio}
                  onChange={setAspectRatio}
                  options={sortAspectRatioOptions(selectedImageAspectOptions.map((v) => ({ label: v, value: v })))}
                  showLeading={false}
                  side="bottom"
                  ariaLabel={tLabel("宽高比")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.mb92421822c21" /></label>
                <FrostedSelect
                  value={resolution}
                  onChange={setResolution}
                  options={selectedImageResolutionOptions.map((v) => ({ label: v, value: v }))}
                  showLeading={false}
                  side="bottom"
                  ariaLabel={tLabel("图片分辨率")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m1e3c56a9a4ca" /></label>
                <input value={imageCount} onChange={(e) => setImageCount(e.target.value)} className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none" />
              </div>
              {selectedModel.includes("seedream") ? (
                <div className="space-y-1">
                  <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2ce512974aa8" /></label>
                  <div className="grid grid-cols-3 gap-2">
                    <FrostedSelect
                      value={seedreamOutputMode}
                      onChange={(v) => setSeedreamOutputMode(v as "single" | "group")}
                      options={[
                        { label: tLabel("单图"), value: "single" },
                        { label: tLabel("系列图"), value: "group" }
                      ]}
                      showLeading={false}
                      compact
                      side="bottom"
                      ariaLabel={tLabel("Seedream 输出模式")}
                    />
                    <input value={seedreamOutputCount} onChange={(e) => setSeedreamOutputCount(e.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[12px] text-[var(--app-fg)] outline-none" />
                    <FrostedSelect
                      value={seedreamWebSearch}
                      onChange={(v) => setSeedreamWebSearch(v as "off" | "on")}
                      options={[
                        { label: tLabel("联网关"), value: "off" },
                        { label: tLabel("联网开"), value: "on" }
                      ]}
                      showLeading={false}
                      compact
                      side="bottom"
                      ariaLabel={tLabel("Seedream 联网")}
                    />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          {toolType === "video" ? (
            <>
              <div className="space-y-1">
                <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.mefaa6864377d" /></label>
                <FrostedSelect
                  value={videoDuration}
                  onChange={setVideoDuration}
                  options={selectedVideoDurationOptions.map((v) => ({ label: v, value: v }))}
                  showLeading={false}
                  side="bottom"
                  ariaLabel={tLabel("视频时长")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.mb92421822c21" /></label>
                <FrostedSelect
                  value={effectiveVideoResolution}
                  onChange={setResolution}
                  options={selectedVideoResolutionOptions.map((v) => ({ label: v, value: v }))}
                  showLeading={false}
                  side="bottom"
                  ariaLabel={tLabel("视频分辨率")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m47b2d56f0bf9" /></label>
                <FrostedSelect
                  value={videoInputMode}
                  onChange={setVideoInputMode}
                  options={selectedVideoInputModeOptions.map((v) => ({ label: v, value: v }))}
                  showLeading={false}
                  side="bottom"
                  ariaLabel={tLabel("视频输入模式")}
                />
              </div>
            </>
          ) : null}

          </div>
        </details>
        <details className="group/advanced border-t border-[var(--border)]">
          <summary className="flex cursor-pointer list-none items-center gap-3 py-3 text-[12px] [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--app-muted)] transition-transform group-open/advanced:rotate-180" />
            <span className="font-medium text-[var(--app-fg)]"><UiText id="admin.m44455611b910" /></span>
            <span className="text-[var(--app-muted)]"><UiText id="admin.m86718030ca6d" /></span>
          </summary>
          <div className="space-y-3 pb-4">

          <div className="space-y-1">
            <label htmlFor="inspiration-description" className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.ma3305e1c352d" /></label>
            <input
              id="inspiration-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="inspiration-params" className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m5031e233600e" /></label>
            <UiProps ids={{"placeholder":["admin.ma7ab17fff771"]}}><textarea
              id="inspiration-params"
              rows={3}
              value={paramsJson}
              onChange={(e) => {
                setParamsJson(e.target.value);
                setParamsJsonEdited(true);
              }}
              placeholder="admin.ma7ab17fff771"
              className="min-h-20 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-[12px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
            /></UiProps>
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  setParamsJsonEdited(false);
                  setParamsJson(autoParamsJson);
                }}
                className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-[11px] text-[var(--app-muted)] hover:text-[var(--app-fg)]"
              ><UiText id="admin.mcbb3ae246804" /></button>
            </div>
          </div>
          </div>
        </details>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--border)] pt-4">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-transparent bg-[var(--primary-bg)] px-4 text-[13px] text-[var(--primary-fg)] hover:opacity-90 disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            {saving ? <UiText id="admin.mce1c9d61565f" /> : <UiText id="admin.m5e7fc79cba78" />}
          </button>
        </div>
          </>
        ) : null}
      </form>

      {message ? <div role="status" className="text-[12px] text-[var(--app-muted)]">{uiError(message)}</div> : null}
        {(importingPackage || exportingBatch) ? (
          <div className="mt-3 space-y-2">
            {importingPackage ? (
              <div>
                <div className="mb-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m3524eeef988e" />{importProgress}%</div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--input-bg)] border border-[var(--border)]">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, importProgress))}%` }}
                  />
                </div>
              </div>
            ) : null}
            {exportingBatch ? (
              <div>
                <div className="mb-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m2282c55b12c6" />{exportProgress}%</div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--input-bg)] border border-[var(--border)]">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, exportProgress))}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
        <div className={`flex flex-wrap items-center justify-between gap-2 ${recentUploadsExpanded ? "mb-3" : ""}`}>
          <div>
            <div className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m7a07d1888544" /></div>
            <div className="mt-1 text-[11px] text-[var(--app-muted)]">
              {recentUploadsExpanded
                ? <UiText id="admin.m5bc160a00a13" values={{v0: String(items.length)}} />
                : items.length > 0
                  ? <UiText id="admin.m5bc160a00a13" values={{v0: String(items.length)}} />
                  : <UiText id="admin.m653621a5c51b" />}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshRecentUploads()}
            disabled={loading}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] disabled:opacity-60"
          >
            <RefreshCw className={["h-4 w-4", loading ? "animate-spin" : ""].join(" ")} /><UiText id="admin.me28be7098db1" /></button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] hover:bg-[var(--panel-3)]">
            <Upload className="h-4 w-4" />
            {importingPackage ? <UiText id="admin.m2f58b6eddc08" /> : <UiText id="admin.m682f467420aa" />}
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={importingPackage}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                void importPackage(file);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => void exportSelectedBatch()}
            disabled={exportingBatch}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {exportingBatch ? <UiText id="admin.m258e73b71e38" /> : <UiText id="admin.m379ddeb9d2cf" values={{v0: String(selectedExportIds.length ? `（${selectedExportIds.length}）` : "")}} />}
          </button>

            {recentUploadsExpanded ? (
              <>
                <span className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m52c963128eab" />{selectedExportIds.length} / {items.length}</span>
                <button
                  type="button"
                  onClick={() => toggleSelectAllVisible()}
                  className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-[11px] text-[var(--app-muted)] hover:text-[var(--app-fg)]"
                >
                  {allVisibleSelected ? <UiText id="admin.mf4d4bae588c4" /> : <UiText id="admin.m70b25d866a2e" />}
                </button>
                <button
                  type="button"
                  onClick={() => invertSelectVisible()}
                  className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-[11px] text-[var(--app-muted)] hover:text-[var(--app-fg)]"
                ><UiText id="admin.mda5a8c3c21f7" /></button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteBatch(true)}
                  disabled={selectedExportIds.length === 0}
                  className="inline-flex h-7 items-center rounded-lg border border-rose-300/40 bg-rose-500/10 px-2 text-[11px] text-rose-500 hover:bg-rose-500/20 disabled:opacity-60"
                ><UiText id="admin.m6315789f6ffa" />{selectedExportIds.length ? `（${selectedExportIds.length}）` : ""}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => setRecentUploadsExpanded((prev) => !prev)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[11px] font-medium text-[var(--app-fg)] hover:bg-[var(--panel-3)]"
              aria-expanded={recentUploadsExpanded}
            >
              {recentUploadsExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {recentUploadsExpanded ? <UiText id="admin.mafd4b783536b" /> : <UiText id="admin.mbc22d3e7ea73" />}
            </button>
          </div>
        </div>
        {!recentUploadsExpanded ? null : loading ? (
          <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m4927a53bcc88" /></div>
        ) : items.length === 0 ? (
          <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.mafe701f303c8" /></div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {items.map((item) => {
              const preview = item.mediaType === "video" ? (item.previewImagePath || item.previewVideoPath) : item.previewImagePath;
              const previewIsVideo = item.mediaType === "video" && preview === item.previewVideoPath;
              return (
                <div
                  key={item.id}
                  onClick={() => void openDetail(item.id)}
                  className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-left transition hover:border-[var(--primary-bg)]/40 cursor-pointer"
                >
                  <div className="absolute z-[1] p-2">
                    <label className="inline-flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-1 text-[11px] text-white">
                      <input
                        type="checkbox"
                        checked={selectedExportIds.includes(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedExportIds((prev) => {
                            if (e.target.checked) return Array.from(new Set([...prev, item.id]));
                            return prev.filter((id) => id !== item.id);
                          });
                        }}
                      /><UiText id="admin.m45c21a9e1fe2" /></label>
                  </div>
                  <div className="relative h-28 w-full bg-[var(--input-bg)]">
                    {preview ? (
                      previewIsVideo ? (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-[var(--app-muted)]">
                          <Video className="h-5 w-5" />
                          <span className="text-[10px]"><UiText id="admin.m05608cc41def" /></span>
                        </div>
                      ) : (
                        <div className="relative h-full w-full">
                          <MediaImage src={preview} alt={item.title} className="h-full w-full object-cover" previewSize={{ width: 720, height: 720 }} />
                          {item.mediaType === "video" ? (
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg">
                                <Video className="h-4 w-4" />
                              </span>
                            </div>
                          ) : null}
                        </div>
                      )
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[var(--app-muted)]">
                        {item.mediaType === "video" ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    {item.sourceLabel ? (
                      <div className="mb-1 inline-flex max-w-full items-center rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2 py-0.5 text-[10px] text-[var(--app-muted)]">
                        <span className="truncate">{item.sourceLabel}</span>
                      </div>
                    ) : null}
                    <div className="overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:1] text-[12px] font-medium text-[var(--app-fg)]">{item.title}</div>
                    <div className="mt-1 overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] text-[11px] text-[var(--app-muted)]">{item.prompt}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-[var(--primary-bg)]">{detailLoading ? <UiText id="admin.m4927a53bcc88" /> : <UiText id="admin.ma748cc074f78" />}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void exportItem(item.id);
                          }}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[11px] text-[var(--app-muted)] hover:text-[var(--app-fg)]"
                        >
                          <Download className="h-3 w-3" /><UiText id="admin.m76420433f22d" /></button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(item.id);
                          }}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-rose-300/40 bg-rose-500/10 px-2 text-[11px] text-rose-500 hover:bg-rose-500/20"
                        >
                          <Trash2 className="h-3 w-3" /><UiText id="admin.m2f9daa828907" /></button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <UiProps ids={{"title":["admin.m21aff65e1294"],"description":["admin.m786f50c2cf05"],"confirmText":["admin.m5e8e7af57abb","admin.ma3ea3c17b401"],"cancelText":["admin.m2cd0f3be8738"]}}><ConfirmDialog
        open={confirmDeleteId !== null}
        title="admin.m21aff65e1294"
        description={confirmDeleteId ? `确定删除模板 #${confirmDeleteId} 吗？将同步删除对应本地素材。` : "admin.m786f50c2cf05"}
        confirmText={deletingId ? "admin.m5e8e7af57abb" : "admin.ma3ea3c17b401"}
        cancelText="admin.m2cd0f3be8738"
        danger
        onConfirm={async () => {
          if (!confirmDeleteId) return;
          await removeItem(confirmDeleteId);
        }}
        onClose={() => {
          if (deletingId) return;
          setConfirmDeleteId(null);
        }}
      /></UiProps>
      <UiProps ids={{"title":["admin.mcc711781c010"],"confirmText":["admin.m7cded04b8394","admin.m96f8e7620317"],"cancelText":["admin.m2cd0f3be8738"]}}><ConfirmDialog
        open={confirmDeleteBatch}
        title="admin.mcc711781c010"
        description={`确定删除已选中的 ${selectedExportIds.length} 个模板吗？将同步删除对应本地素材。`}
        confirmText={deletingBatch ? "admin.m7cded04b8394" : "admin.m96f8e7620317"}
        cancelText="admin.m2cd0f3be8738"
        danger
        onConfirm={async () => {
          await deleteSelectedBatch();
        }}
        onClose={() => {
          if (deletingBatch) return;
          setConfirmDeleteBatch(false);
        }}
      /></UiProps>
    </div>
  );
}
