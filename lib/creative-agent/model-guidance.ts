/** Curated, dated writing guidance. Runtime catalog parameters remain authoritative. */
type Source = { title: string; url: string; checkedAt: string };
type Profile = {
  id: string;
  title: string;
  scope: string;
  sources: Source[];
  promptGuidance: string[];
  cautions: string[];
  creativeMethod?: "seedance_2_0" | "seedance_2_5";
};
const source = (title: string, url: string): Source => ({ title, url, checkedAt: "2026-10-14" });
const profiles: Record<string, Profile> = {
  gpt_image: {
    id: "gpt_image", title: "GPT Image 图像生成与编辑",
    scope: "GPT Image 系列通用写作方法，不把其他版本的参数或质量比较套给当前供应商。",
    sources: [source("OpenAI 图像提示词指南", "https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide")],
    promptGuidance: ["说明用途、主体、构图和可见细节；复杂任务分成场景、主体、细节、约束。", "编辑时分别列出要改的内容和必须保留的身份、几何、布局等；真实参考逐项说明用途。", "需要画面文字时明确原文与位置；修改时每次聚焦一个问题，核对输出后再继续。"],
    cautions: ["不能仅凭型号断言真人或多视图一致性优于其他模型。连续编辑仍可能漂移，须逐次核对。"],
  },
  gpt_image_25: {
    id: "gpt_image_25", title: "GPT Image 2.5",
    scope: "官方 2.5 指南；Flare / Sunburst 的定位只适用于实际映射到对应版本的模型。",
    sources: [source("OpenAI GPT Image 2.5 提示词指南", "https://developers.openai.com/api/docs/guides/image-prompting")],
    promptGuidance: ["先明确用途、主体与构图，再写细节和约束；精确文字用引号标记。", "编辑分开写修改项与保持项，为每张真实参考指定身份、服装、背景或风格用途。", "官方定位 Flare 偏重速度、Sunburst 偏重质量；应以相同输入与参数在自己的任务上比较，不能保证固定提速或更便宜。"],
    cautions: ["相同 quality 标签不等于相同质量。官方示例中的参数不自动成为当前渠道支持项。", "局部编辑仍需检查无关区域是否变化，提示词无法保证像素完全不变。"],
  },
  gemini_image: {
    id: "gemini_image", title: "Gemini / Nano Banana 图像方法",
    scope: "Gemini 原生图像模型的通用提示词方法，不据此宣称各渠道、Flash/Pro 或新版本能力完全一致。",
    sources: [source("Google Gemini 图像生成指南", "https://ai.google.dev/gemini-api/docs/image-generation")],
    promptGuidance: ["用连贯的场景描述说明主体、构图、动作、光线与用途，避免只堆关键词。", "多图组合时明确每张图贡献哪个主体或元素，编辑时说明变化怎样融入原图。", "复杂画面拆成明确的空间层次；优先正面描述希望出现的状态。"],
    cautions: ["引用数量、分辨率和编辑模式以当前渠道参数为准。", "连续改图需提供实际上一版输出，不能假定独立调用自动保留之前的图像上下文。"],
  },
  seedream: {
    id: "seedream", title: "Seedream 4.0 / 4.5 / 5.0 lite",
    scope: "官方指南明确覆盖 4.0、4.5、5.0 lite；不把该版本范围扩展成其他型号的能力声明。",
    sources: [source("火山引擎 Seedream 4.0–5.0 提示词指南", "https://docs.volcengine.com/docs/ark/seedream-4-0-5-0-prompt-guide?lang=zh")],
    promptGuidance: ["用自然语言连贯写清主体、行为与环境，再补构图、光影、色彩和风格。", "说明图像实际用途，例如角色参考、商品图或海报；有明确风格时提供准确风格描述或真实参考。", "编辑要说明改哪里、怎么改以及保持什么；参数与提示词中的画幅要求保持一致。"],
    cautions: ["官方提供参考与组图写法不表示当前工具支持一次生成整组；调用次数以当前工具协议为准。", "没有跨模型对比证据时，不能宣称 Seedream 的电影光影更强。"],
  },
  seedream_5_pro: {
    id: "seedream_5_pro", title: "Seedream 5.0 pro",
    scope: "5.0 pro 官方产品与编辑说明；这里只描述创作组织方式，不开放新 API 能力。",
    sources: [source("火山引擎 Seedream 5.0 pro", "https://docs.volcengine.com/docs/ark/seedream-5-0-pro?lang=zh")],
    promptGuidance: ["明确本次是生成还是编辑；用自然语言描述目标主体、文字、背景以及要修改的具体元素。", "涉及精确位置时需要真实输入位置依据；只有当前工具实际支持坐标或区域输入时才准备对应编辑方式。"],
    cautions: ["官方展示交互编辑和图层能力不代表当前画布工具已接入，不能编造坐标字段或拆层工具。", "不能将 5.0 lite 的限制、5.0 pro 的特性或第三方别名互相替代；不预设电影光影排名。"],
  },
  seedance_2_0: {
    id: "seedance_2_0", title: "Seedance 2.0 视频提示词",
    scope: "2.0 系列官方写作建议与本项目分段方法；Fast/Mini 等变体限制必须分别核对。",
    sources: [source("火山引擎 Seedance 2.0 提示词指南", "https://docs.volcengine.com/docs/ark/seedance-2-0-prompt-guide?lang=zh&redirect=1")],
    promptGuidance: ["明确主体、动作细节、场景、光影、镜头运动、风格与约束，按镜头顺序组织具体事件。", "参考素材写清用于样貌、动作、声音还是风格；编号必须与真实提交顺序一致。", "对白指明说话人和语言，镜头动作与声音安排在可完成的时间段内。"],
    cautions: ["本地支持哪些输入类型、时长和声音参数以实时模型目录为准。", "不将复杂动作或跨镜头连续性写成保证成功；真实结果仍需观察。"],
    creativeMethod: "seedance_2_0",
  },
  seedance_2_5: {
    id: "seedance_2_5", title: "Seedance 2.5 视频提示词",
    scope: "2.5 官方写作建议；现有项目模板由 creative_method 承担，官方示例不覆盖用户定稿。",
    sources: [source("火山引擎 Seedance 2.5 提示词指南", "https://docs.volcengine.com/docs/ark/seedance-2-5-prompt-guide?lang=en")],
    promptGuidance: ["先概述主体、地点、事件与风格，再按镜头或时间块写出具体画面、动作、台词、音效。", "为图片、视频、音频分别指定真实编号与用途，避免形象、声音、动作参考混淆。", "以正向描述为主；无字幕、无背景音乐等声音和文字约束需写清，具体情节不能只剩时间戳。"],
    cautions: ["官方上限不等于当前渠道已开放的上限，不能凭资料绕过实时工具参数校验。", "不能把编辑、延长或多语言宣传当成本项目已支持的调用模式。"],
    creativeMethod: "seedance_2_5",
  },
};

function profileFor(model: string, mediaType: "image" | "video"): Profile | undefined {
  const id = model.toLowerCase();
  if (mediaType === "image") {
    if (/gpt-image-2[.-]5/.test(id)) return profiles.gpt_image_25;
    if (/gpt-image-(?:1(?:\.5)?|2(?:\.6)?)(?:$|[-:/])/.test(id)) return profiles.gpt_image;
    if (id.includes("nano-banana") || /^gemini-.*image/.test(id) || /^google\/gemini-.*image/.test(id)) return profiles.gemini_image;
    if (id.includes("seedream-5.0-pro")) return profiles.seedream_5_pro;
    if (/seedream-(?:4[.-][05]|5[.-]0-lite)(?:$|[-:/])/.test(id)) return profiles.seedream;
  } else {
    if (/seedance-2[.-]5/.test(id)) return profiles.seedance_2_5;
    if (/seedance-2[.-]0/.test(id)) return profiles.seedance_2_0;
  }
}

export function modelGuidanceSummary(model: string, mediaType: "image" | "video") {
  const profile = profileFor(model, mediaType);
  return { profileId: profile?.id ?? null, title: profile?.title ?? "尚无专项资料", basis: profile ? "official_guidance" : "unverified", checkedAt: profile?.sources[0].checkedAt ?? null };
}

export function readModelGuidance(model: string, mediaType: "image" | "video") {
  const profile = profileFor(model, mediaType);
  return {
    model, mediaType, ...modelGuidanceSummary(model, mediaType), ...profile,
    sources: profile?.sources ?? [],
    localComparativeEvidence: [],
    evidencePolicy: "官方资料仅提供写作依据，不证明本渠道全部能力或本地质量优势。参数/输入模式以 generation_models 为准；没有专项资料或本地实测时明确未知，不编造擅长场景、速度、价格或一致性排名。推荐时说明来源、适用范围及与当前任务的关系。",
    projectStrategy: ["优先满足用户已选模型、输入类型、画幅/时长等硬条件。用当前任务的验收点比较候选，不按型号名自动排序。", "角色参考核对身份与多视角；场景核对空间布局与光源；商品核对结构/标识；视频核对动作、声音与连续性。这是项目检查方法，不是模型能力事实。", "仅需少量关键选择时合并提问，并给可选补充说明；已知型号、范围或要求直接沿用。"],
    ...(!profile ? { promptGuidance: ["使用已读取的通用创作方法，说明主体、用途、构图/动作和保持项；不使用未经核实的模型特殊语法。"] } : {}),
  };
}
