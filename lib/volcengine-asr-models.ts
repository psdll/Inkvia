/** 火山引擎豆包语音 · 大模型录音文件识别极速版（Agent 拆解视频时识别台词，不是语音合成） */
export const VOLC_ASR_MODEL_ID = "doubao-asr-flash" as const;
export const VOLC_ASR_MODEL_LABEL = "豆包语音识别·极速版";
export const VOLC_ASR_PROVIDER_ID = "volcengine-speech" as const;
export const isVolcAsrModel = (modelId: string) => modelId === VOLC_ASR_MODEL_ID;
