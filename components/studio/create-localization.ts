"use client";

import { useUiLocale } from "@/i18n/ui";

const generationLabelMessages: Record<string, string> = {
  "生成": "createDynamic.m1ad1463fe16f",
  "暂无可用模型": "createDynamic.m0c4ff1cbb701",
  "草稿服务暂时不可用": "createDynamic.m260237bd0d64",
  "正在加载草稿…": "createDynamic.m5210d0587a33",
  "正在检查素材…": "createDynamic.m69d4a3072088",
  "正在运行技能…": "createDynamic.m26a73c833a6d",
  "正在提交模型…": "createDynamic.m1f873c59010a",
  "请处理上传失败素材": "createDynamic.me1daef36328e",
  "素材上传中…": "createDynamic.m3bb056e06989",
  "请处理不合规素材": "createDynamic.mbf972bcbff32",
  "请确认真人脸提示": "createDynamic.m329faa91fcc2",
};
const parameterLabelMessages: Record<string, string> = {
  "网页": "createDynamic.m005074b65962",
  "图片": "createDynamic.md24c10d37db0",
  "网页和图片": "createDynamic.mc9197e2aa785",
  "超高": "createDynamic.m8696c49ac55b",
  "极致": "createDynamic.m5b0aad5e3eff",
  "自适应": "createDynamic.m8f1f75950e38",
  "自定义": "createDynamic.m4eafa9e925b3",
  "低": "createDynamic.maa9e366f68d3",
  "标准": "createDynamic.m6bea77acefb3",
  "高": "createDynamic.mb1c27820fec2",
  "图片质量": "createDynamic.m0ab5629be565",
  "画质": "createDynamic.m77ccdb7ba817",
  "比例": "createDynamic.m82a59f3d1c16",
  "宽高比": "createDynamic.m22aca111bd1d",
  "分辨率": "createDynamic.mb92421822c21",
  "清晰度": "createDynamic.m0e22652107f5",
  "数量": "createDynamic.m5e29d121dda0",
  "出图模式": "createDynamic.m68ab55745ca3",
  "单图": "createDynamic.me71b76b45a24",
  "系列图": "createDynamic.m9bbfefa108cf",
  "系列图张数": "createDynamic.m0fd77fbafa87",
  "慢速": "createDynamic.ma63d2ddd3f94",
  "快速": "createDynamic.mdb945cfe9f9f",
  "极速": "createDynamic.m89bc4cb34d02",
  "自动清晰度": "createDynamic.mc424d127e2af",
  "自动": "createDynamic.m7eb336e42cb5",
  "透明": "createDynamic.m9dddd9f908b2",
  "不透明": "createDynamic.m1bc0b872e7fd",
  "全能参考": "createDynamic.m47c8726b74ff",
  "首尾帧": "createDynamic.ma44f24ac18b3",
  "首帧图": "createDynamic.m7ad8efa70b58",
  "文生视频": "createDynamic.m0ea604fc4a26",
  "视频编辑": "createDynamic.m4d3c81d0c90b",
  "视频续写": "createDynamic.m6042c5e9e4e0",
  "模型": "createDynamic.mc98e118e0a43",
  "视频生成模式": "createDynamic.m1cb2da1e673a",
  "输入模式": "createDynamic.m47b2d56f0bf9",
  "时长": "createDynamic.m04a95e0654d3",
  "生成音频": "createDynamic.mb311c8ba2968",
  "开启": "createDynamic.m8da97ddda990",
  "关闭": "createDynamic.m3fd47edce45b",
  "自动时长": "createDynamic.m7abe8fbc82d9",
};

// Translate only application-owned labels. Model names, media names and prompts
// retain their original values throughout the workspace and upload paths.
export function useCreateLocalization() {
  const context = useUiLocale();
  const { text } = context;
  const localize = (messages: Record<string, string>, label: string) => {
    const key = Object.hasOwn(messages, label) ? messages[label] : undefined;
    return key ? text(key) : label;
  };
  return {
    ...context,
    generationLabel: (label: string) => localize(generationLabelMessages, label),
    parameterLabel: (label: string) => localize(parameterLabelMessages, label),
  };
}
