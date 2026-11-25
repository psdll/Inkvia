import { tariffLabel } from "@/lib/billing/apimart-pricing";

export function priceConditionLabel(conditions: Record<string, unknown>) {
  const names: Record<string, string> = {
    resolution: "分辨率", quality: "画质", aspectRatio: "比例", duration: "时长",
    generateAudio: "生成音频", inputContainsReferenceMedia: "参考素材", providerModel: "上游模型", speed: "速度",
  };
  return Object.entries(conditions).map(([key, value]) => {
    if (["midjourneyAction", "deepseekTimeBand", "minimaxInputBand", "inputBand", "timeBand", "inputContainsVideo", "maxMode"].includes(key))
      return (Array.isArray(value) ? value : [value]).map((item) => tariffLabel({ [key]: typeof item === "boolean" ? String(item) : item })).join("、");
    const values = (Array.isArray(value) ? value : [value]).map((item) =>
      item === true || item === "true" ? "有" : item === false || item === "false" ? "无" : String(item));
    return `${names[key] || key} ${values.join("、")}`;
  }).join(" / ") || "全部参数同价";
}
