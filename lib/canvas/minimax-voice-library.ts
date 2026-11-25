export type CanvasVoiceSource = "system" | "cloned" | "generated";
export type CanvasVoiceGender =
  | "male"
  | "female"
  | "character"
  | "unknown";
export type CanvasVoiceAge =
  | "youth"
  | "adult"
  | "child"
  | "senior"
  | "unknown";
export type CanvasVoiceTab = "system" | "mine" | "favorites";

export type CanvasMiniMaxVoice = {
  id: string;
  name: string;
  description: string;
  source: CanvasVoiceSource;
  language?: string;
  accent?: string;
  gender: CanvasVoiceGender;
  age: CanvasVoiceAge;
  canRename?: boolean;
  canDelete?: boolean;
};

export type CanvasVoiceFilters = {
  language: string[];
  accent: string[];
  gender: CanvasVoiceGender[];
  ages: CanvasVoiceAge[];
};

export const EMPTY_CANVAS_VOICE_FILTERS: CanvasVoiceFilters = {
  language: [],
  accent: [],
  gender: [],
  ages: [],
};

export const MINIMAX_VERIFIED_VOICE_SEED: CanvasMiniMaxVoice[] = [
  {
    id: "female-shaonv",
    name: "少女音色",
    description: "MiniMax 系统音色",
    source: "system",
    language: "zh",
    accent: "mandarin",
    gender: "female",
    age: "youth",
  },
];

function normalizedText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

function includesAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value));
}

const LANGUAGE_SIGNALS: Array<[string, string[]]> = [
  ["yue", ["cantonese", "粤语", "粤文"]],
  ["ja", ["japanese", "日语", "日文", "日本"]],
  ["ko", ["korean", "韩语", "韩文", "韩国"]],
  ["tr", ["turkish", "土耳其语"]],
  ["uk", ["ukrainian", "乌克兰语"]],
  ["es", ["spanish", "西班牙语"]],
  ["pt", ["portuguese", "葡萄牙语"]],
  ["fr", ["french", "法语"]],
  ["de", ["german", "德语"]],
  ["id", ["indonesian", "印度尼西亚语", "印尼语"]],
  ["it", ["italian", "意大利语"]],
  ["ru", ["russian", "俄语"]],
  ["ar", ["arabic", "阿拉伯语"]],
  ["nl", ["dutch", "荷兰语"]],
  ["vi", ["vietnamese", "越南语"]],
  ["en", ["english", "英语", "英文"]],
  ["zh", ["mandarin", "chinese", "中文", "普通话", "-qn-"]],
];

export function inferCanvasVoiceMetadata(
  voice: Omit<CanvasMiniMaxVoice, "gender" | "age"> &
    Partial<Pick<CanvasMiniMaxVoice, "gender" | "age">>,
): CanvasMiniMaxVoice {
  const text = normalizedText(
    `${voice.id} ${voice.name} ${voice.description}`,
  );
  const identityText = normalizedText(`${voice.id} ${voice.name}`);
  const explicitLanguage = normalizedText(voice.language);
  let language = explicitLanguage;
  if (!language) {
    const signaledLanguage = LANGUAGE_SIGNALS.find(([, signals]) =>
      includesAny(text, signals),
    )?.[0];
    if (signaledLanguage) {
      language = signaledLanguage;
    } else if (/[\u3040-\u30ff]/u.test(identityText)) {
      language = "ja";
    } else if (/[\uac00-\ud7af]/u.test(identityText)) {
      language = "ko";
    } else if (/[\u3400-\u9fff]/u.test(identityText)) {
      language = "zh";
    } else if (
      voice.source === "system" &&
      /[a-z]/u.test(normalizedText(voice.name))
    ) {
      language = "en";
    } else {
      language = "multi";
    }
  }
  const accent =
    voice.accent ||
    (includesAny(text, ["普通话", "mandarin", "-qn-"])
      ? "mandarin"
      : undefined);

  let gender = voice.gender || "unknown";
  if (gender === "unknown") {
    if (
      includesAny(text, ["female-", "女声", "女性", "少女", "御姐", "girl"])
    ) {
      gender = "female";
    } else if (includesAny(text, ["male-", "男声", "男性", "boy"])) {
      gender = "male";
    } else if (includesAny(text, ["角色", "卡通", "character", "cartoon"])) {
      gender = "character";
    }
  }

  let age = voice.age || "unknown";
  if (age === "unknown") {
    if (includesAny(text, ["儿童", "孩子", "child", "boy", "girl"])) {
      age = "child";
    } else if (
      includesAny(text, ["青年", "少女", "大学生", "young", "-qn-"])
    ) {
      age = "youth";
    } else if (includesAny(text, ["老年", "老人", "senior", "elder"])) {
      age = "senior";
    } else if (includesAny(text, ["成年", "成熟", "御姐", "adult", "mature"])) {
      age = "adult";
    }
  }

  return {
    ...voice,
    description: String(voice.description || "").trim(),
    language,
    accent,
    gender,
    age,
  };
}

export function filterCanvasVoices(input: {
  voices: CanvasMiniMaxVoice[];
  tab: CanvasVoiceTab;
  query: string;
  favoriteIds: ReadonlySet<string>;
  filters: CanvasVoiceFilters;
}) {
  const query = normalizedText(input.query);
  const ages = new Set(input.filters.ages);
  return input.voices.filter((voice) => {
    if (input.tab === "system" && voice.source !== "system") return false;
    if (
      input.tab === "mine" &&
      voice.source !== "cloned" &&
      voice.source !== "generated"
    ) {
      return false;
    }
    if (input.tab === "favorites" && !input.favoriteIds.has(voice.id)) {
      return false;
    }
    if (
      query &&
      !normalizedText(`${voice.id} ${voice.name} ${voice.description}`).includes(
        query,
      )
    ) {
      return false;
    }
    if (input.filters.language.length && !input.filters.language.includes(voice.language || "")) {
      return false;
    }
    if (input.filters.accent.length && !input.filters.accent.includes(voice.accent || "")) {
      return false;
    }
    if (input.filters.gender.length && !input.filters.gender.includes(voice.gender)) {
      return false;
    }
    if (ages.size > 0 && !ages.has(voice.age)) return false;
    return true;
  });
}

export function paginateCanvasVoices(
  voices: CanvasMiniMaxVoice[],
  requestedPage: number,
  requestedPageSize: number,
) {
  const pageSize = Math.max(1, Math.trunc(requestedPageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(voices.length / pageSize));
  const page = Math.min(
    pageCount,
    Math.max(1, Math.trunc(requestedPage) || 1),
  );
  const start = (page - 1) * pageSize;
  return {
    page,
    pageCount,
    total: voices.length,
    items: voices.slice(start, start + pageSize),
  };
}

export function paginationItems(
  requestedPage: number,
  requestedPageCount: number,
): Array<number | "ellipsis"> {
  const pageCount = Math.max(1, Math.trunc(requestedPageCount) || 1);
  const currentPage = Math.min(
    pageCount,
    Math.max(1, Math.trunc(requestedPage) || 1),
  );
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  if (currentPage <= 3) return [1, 2, 3, 4, 5, "ellipsis", pageCount];
  if (currentPage >= pageCount - 2) {
    return [
      1,
      "ellipsis",
      pageCount - 4,
      pageCount - 3,
      pageCount - 2,
      pageCount - 1,
      pageCount,
    ];
  }
  return [
    1,
    "ellipsis",
    currentPage - 2,
    currentPage - 1,
    currentPage,
    currentPage + 1,
    currentPage + 2,
    "ellipsis",
    pageCount,
  ];
}
