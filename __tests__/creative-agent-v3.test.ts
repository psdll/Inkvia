import { describe, expect, it } from "vitest";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { getVideoModelSpec } from "@/lib/sora2";
import type { EffectiveMediaCatalog } from "@/lib/creative-agent/effective-media-catalog";
import { nearestRatio, routeImage, routeVideo } from "@/lib/creative-agent/v3/model-router";
import { canvasAliases, describeCanvas } from "@/lib/creative-agent/v3/canvas-context";
import { compactHistory, saidButDidNot, stripPrematureCompletion } from "@/lib/creative-agent/v3/runner";
import { buildCreativeAgentV3SystemPrompt, CREATIVE_AGENT_V3_RULES } from "@/lib/creative-agent/v3/prompt";
import { normalizeReferenceTokens, referenceTokens } from "@/lib/creative-agent/v3/asset-tokens";

const qualification = { available: true, reasons: [], entitlement: "unverified" as const, providerId: "p", adapterId: "a", routeConfigFingerprint: "f" };
const image = (id: string, label: string) => ({ id, label, params: getImageModelParams(id), aliases: [id, label], qualification });
const video = (id: string) => ({ ...getVideoModelSpec(id), aliases: [id], qualification });
const catalog = {
  version: 1, fingerprint: "x", unavailable: [],
  image: [image("gpt-image-2.5-flare-openrouter", "GPT-Image-2.5 Fast"), image("gemini-3-pro-image", "nano-banana-pro"), image("midjourney-v8-apimart", "Midjourney-V8.2"), image("doubao-seedream-5.0-pro", "Doubao-Seedream-5.0-Pro")],
  video: [video("doubao-seedance-2.0-face"), video("seedance-2.5-apimart")],
} as unknown as EffectiveMediaCatalog;
const imageRef = { nodeId: "node-1", semanticHash: "a".repeat(64), kind: "image" as const, url: "/uploads/a.png" };

describe("Agent v3 模型匹配", () => {
  it("手动固定的模型必须使用，即使智能匹配会选别的", () => {
    const routed = routeImage(catalog, { mode: "explicit", model: "doubao-seedream-5.0-pro" }, { prompt: "雨夜霓虹街道海报", userText: "做一张雨夜霓虹海报", references: [] });
    expect(routed.model).toBe("doubao-seedream-5.0-pro");
    expect(routed.reason).toBe("preference");
  });
  it("用户在消息里点名另一个模型时以消息为准", () => {
    const routed = routeImage(catalog, { mode: "explicit", model: "doubao-seedream-5.0-pro" }, { prompt: "海报", userText: "这次用 nano-banana-pro 做一张海报", references: [] });
    expect(routed.model).toBe("gemini-3-pro-image");
    expect(routed.reason).toBe("requested");
  });
  it("智能匹配：改图不会选不支持参考图的模型", () => {
    const routed = routeImage(catalog, { mode: "auto" }, { prompt: "保持主体不变，把背景改为米色", userText: "背景改成米色，其他不变", references: [imageRef] });
    expect(routed.model).not.toBe("midjourney-v8-apimart");
    expect(routed.args.references).toEqual([{ nodeId: "node-1", semanticHash: "a".repeat(64) }]);
  });
  it("智能匹配：一次出多个方向时优先出图快的模型；Agent 提示词里的“高清”不算用户要高质量", () => {
    const routed = routeImage(catalog, { mode: "auto" }, { prompt: "咖啡海报，商业摄影质感，高清", userText: "帮我做一张咖啡店新品海报", references: [], count: 4 });
    expect(routed.model).toBe("gpt-image-2.5-flare-openrouter");
  });
  it("智能匹配：单张且用户要高清精修时选高质量模型", () => {
    const routed = routeImage(catalog, { mode: "auto" }, { prompt: "咖啡海报", userText: "做一张高清精修的咖啡海报", references: [], count: 1 });
    expect(["gpt-image-2.5-sunburst-openrouter", "doubao-seedream-5.0-pro"]).toContain(routed.model);
  });
  it("偏好里固定的比例优先于 Agent 建议，并规整到模型支持的比例", () => {
    const routed = routeImage(catalog, { mode: "auto", params: { aspectRatio: "9:16" } }, { prompt: "海报", userText: "做张海报", aspectRatio: "3:4", references: [] });
    expect(routed.args.params.aspectRatio).toBe("9:16");
  });
  it("分辨率默认 2K；偏好里手动选 1K 才用 1K；Agent 自己填的 1K 不算", () => {
    expect(routeImage(catalog, { mode: "auto" }, { prompt: "海报", userText: "做张海报", references: [] }).args.params.resolution).toBe("2K");
    expect(routeImage(catalog, { mode: "auto", params: { resolution: "auto" } }, { prompt: "海报", userText: "做张海报", references: [] }).args.params.resolution).toBe("2K");
    expect(routeImage(catalog, { mode: "auto" }, { prompt: "海报", userText: "做张海报", resolution: "1K", references: [] }).args.params.resolution).toBe("2K");
    expect(routeImage(catalog, { mode: "auto", params: { resolution: "1K" } }, { prompt: "海报", userText: "做张海报", references: [] }).args.params.resolution).toBe("1K");
    expect(routeImage(catalog, { mode: "explicit", model: "gpt-image-2.5-flare-openrouter", params: { resolution: "4K" } }, { prompt: "海报", userText: "做张海报", aspectRatio: "16:9", references: [] }).args.params.resolution).toBe("4K");
    expect(routeImage(catalog, { mode: "auto" }, { prompt: "海报", userText: "出一张 1K 的小图", resolution: "1K", references: [] }).args.params.resolution).toBe("1K");
  });
  it("视频：一张参考图默认作为首帧，时长在模型范围内", () => {
    const routed = routeVideo(catalog, { mode: "auto" }, { prompt: "按摩椅缓慢展开", userText: "用这张图做视频", references: [imageRef], duration: 10 });
    expect(routed.args.params.inputMode).toBe("first_frame");
    expect(routed.args.params.duration).toBe(10);
  });
  it("视频分辨率默认 720p；用户说了 1080p 才换档，Agent 自己填的不算", () => {
    expect(routeVideo(catalog, { mode: "auto" }, { prompt: "海浪", userText: "做个海浪视频", references: [] }).args.params.resolution).toBe("720p");
    expect(routeVideo(catalog, { mode: "auto" }, { prompt: "海浪", userText: "做个海浪视频", resolution: "1080p", references: [] }).args.params.resolution).toBe("720p");
    expect(routeVideo(catalog, { mode: "auto" }, { prompt: "海浪", userText: "做个 1080P 的海浪视频", resolution: "1080p", references: [] }).args.params.resolution).toBe("1080p");
  });
  it("视频默认带声音；用户说不要声音或偏好关闭才静音，Agent 自己传的 false 不算", () => {
    const route = (userText: string, audio?: boolean, generateAudio?: boolean) => routeVideo(catalog, { mode: "explicit", model: "seedance-2.5-apimart", ...(generateAudio === undefined ? {} : { params: { generateAudio } }) }, { prompt: "雨夜对峙", userText, references: [], audio }).args.params.generateAudio;
    expect(route("做个雨夜对峙的短剧镜头")).toBe(true);
    expect(route("做个雨夜对峙的短剧镜头", false)).toBe(true);
    expect(route("做个雨夜镜头，不要声音")).toBe(false);
    expect(route("做个雨夜镜头", undefined, false)).toBe(false);
  });
  it("自动换模型重试时跳过刚失败的模型", () => {
    const first = routeImage(catalog, { mode: "auto" }, { prompt: "海报", userText: "做张海报", references: [] });
    const next = routeImage(catalog, { mode: "auto" }, { prompt: "海报", userText: "做张海报", references: [], exclude: [first.model] });
    expect(next.model).not.toBe(first.model);
    expect(next.reason).toBe("auto");
    const video = routeVideo(catalog, { mode: "auto" }, { prompt: "海浪", userText: "做个海浪视频", references: [] });
    expect(routeVideo(catalog, { mode: "auto" }, { prompt: "海浪", userText: "做个海浪视频", references: [], exclude: [video.model] }).model).not.toBe(video.model);
  });
  it("比例取最接近的可用值", () => {
    expect(nearestRatio("2.35:1", ["1:1", "16:9", "21:9", "9:16"], "1:1")).toBe("21:9");
    expect(nearestRatio("3：4", ["3:4", "1:1"], "1:1")).toBe("3:4");
    expect(nearestRatio(undefined, ["1:1", "16:9"], "16:9")).toBe("16:9");
  });
});

describe("Agent v3 上下文", () => {
  it("画布短编号唯一且稳定", () => {
    const nodes = [{ id: "abcdef12-0000" }, { id: "abcdef12-1111" }, { id: "99999999-0000" }] as never[];
    const aliases = canvasAliases(nodes);
    expect(new Set(aliases.values()).size).toBe(3);
    expect(aliases.get("99999999-0000")).toBe("999999");
  });
  it("画布摘要按生成时间排新旧，而不是读取顺序；最新的一张标【最新】", () => {
    const task = (id: string, title: string, time: number) => ({ id, position: { x: 0, y: 0 }, data: { kind: "imageTask", title, task: { references: [], settings: { prompt: title }, batches: [{ id: `b-${id}`, createdAt: time, settings: { prompt: title, aspectRatio: "3:4" }, outputs: [{ id: `o-${id}`, status: "success", url: "/uploads/x.png", finishedAt: time + 10 }] }] } } });
    const snapshot = { revision: "1", edgeIds: [], nodes: [task("aaaaaa-old", "旧图", 1000), task("ffffff-new", "新图", 9000), task("cccccc-mid", "中间", 5000)] };
    const digest = describeCanvas(snapshot as never, []);
    const lines = digest.text.split("\n");
    expect(lines[0]).toContain("【最新】图片「新图」");
    expect(lines[1]).toContain("中间");
    expect(lines[2]).toContain("旧图");
  });
  it("历史轮次：保留截短后的工具调用和结果（模型才知道“做”要靠工具），去掉技能正文、思考和图片", () => {
    const longPrompt = "雨夜霓虹街道，".repeat(80);
    const messages = [
      { role: "user", content: "做海报\n\n【已选技能：海报大师（personal:1）】\n很长的技能正文……", timestamp: 1 },
      { role: "assistant", content: [{ type: "thinking", thinking: "内部思考" }, { type: "text", text: "我出 4 版" }, { type: "toolCall", id: "c1", name: "generate_image", arguments: { images: [{ title: "雨夜版", prompt: longPrompt }] } }], stopReason: "toolUse" },
      { role: "toolResult", toolCallId: "c1", toolName: "generate_image", content: [{ type: "text", text: "4 项已完成" }, { type: "image", data: "xxx", mimeType: "image/png" }], isError: false },
      { role: "assistant", content: [{ type: "text", text: "4 版都做好了" }], stopReason: "stop" },
      { role: "user", content: "再来一版", timestamp: 2 },
    ] as never[];
    const compacted = compactHistory(messages, 4) as { role: string; content: unknown }[];
    expect(compacted.map(message => message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    const json = JSON.stringify(compacted);
    expect(json).not.toContain("很长的技能正文");
    expect(json).not.toContain("内部思考");
    expect(json).not.toContain("image/png");
    expect(json).toContain("generate_image");
    expect(json).toContain("雨夜版");
    expect(json).not.toContain(longPrompt);
    expect(json).toContain("4 项已完成");
    expect(json).toContain("4 版都做好了");
  });
  it("历史轮次：没有结果的工具调用（被中断）不带入，避免调用与结果不配对", () => {
    const messages = [
      { role: "user", content: "做海报", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "我来做" }, { type: "toolCall", id: "c1", name: "generate_image", arguments: {} }], stopReason: "toolUse" },
      { role: "user", content: "算了换个主题", timestamp: 2 },
    ] as never[];
    const compacted = compactHistory(messages, 2) as { role: string; content: unknown }[];
    expect(compacted.map(message => message.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(compacted)).not.toContain("toolCall");
  });
  it("系统提示词保持精简，并包含关键行为规则", () => {
    expect(CREATIVE_AGENT_V3_RULES.length).toBeLessThan(2600);
    const prompt = buildCreativeAgentV3SystemPrompt({ canvas: "（画布是空的）", preferences: "图片智能匹配；视频智能匹配", models: { image: ["a：快"], video: [] }, skills: [] });
    expect(prompt).toContain("用户没说数量时只出 1 张");
    expect(prompt).not.toContain("默认出 4 个");
    expect(prompt).toContain("ask_user");
    expect(prompt).not.toMatch(/facts|semanticHash|actionId/);
  });
});

describe("Agent v3 只说不做的兜底", () => {
  const user = { role: "user", content: "把场景中的按摩椅去掉", timestamp: 5 };
  const say = (text: string, extra: unknown[] = []) => ({ role: "assistant", content: [{ type: "text", text }, ...extra], stopReason: extra.length ? "toolUse" : "stop" });
  it("说了要动手却没调用工具：需要提醒", () => {
    expect(saidButDidNot([user, say("我基于刚做好的客厅图，只去掉画面中的按摩椅，其他保持不变。")] as never[], 5, "把场景中的按摩椅去掉")).toBe(true);
  });
  it("已经调用过生成工具后的收尾不算", () => {
    const messages = [user, say("我基于客厅图去掉按摩椅。", [{ type: "toolCall", id: "c", name: "generate_image", arguments: {} }]),
      { role: "toolResult", toolCallId: "c", toolName: "generate_image", content: [], isError: false }, say("我把按摩椅去掉了，其他保持不变。")];
    expect(saidButDidNot(messages as never[], 5, "把场景中的按摩椅去掉")).toBe(false);
  });
  it("用户只是提问时不提醒", () => {
    expect(saidButDidNot([{ ...user, content: "这张图怎么样？" }, say("我来帮你分析一下")] as never[], 5, "这张图怎么样？")).toBe(false);
  });
  it("没调用工具却宣布做好了（带长列表）也要拦下", () => {
    const fake = "我再出 3 个差异明显的方向：国风水墨、潮流撞色、暖调手持生活感，都是 3:4 竖版新品海报。\n\n三版都好了：\n\n1. **国风水墨版**——白瓷杯配金桂、宣纸与水墨晕染，书法标题「桂花乌龙」，雅致东方感。\n2. **撞色潮流版**——琥珀茶汤撞青蓝与暖橙大色块，粗体「秋日新品」排版，年轻吸睛。\n3. **手持暖秋生活版**——米白毛衣双手捧外带纸杯，桂花散落、热气升腾，ins 治愈氛围感。\n\n可以选定一版继续调文案、加品牌名和价格，或把某个方向延展成系列内页图。";
    expect(saidButDidNot([{ ...user, content: "再出 3 版不同风格的" }, say(fake)] as never[], 5, "再出 3 版不同风格的")).toBe(true);
    expect(stripPrematureCompletion(fake)).toBe("我再出 3 个差异明显的方向：国风水墨、潮流撞色、暖调手持生活感，都是 3:4 竖版新品海报。");
  });
  it("写脚本、文案这类文字任务，回答里说“完成”不算假完成", () => {
    expect(saidButDidNot([{ ...user, content: "帮我写一个按摩椅的视频脚本" }, say("脚本已完成，共 6 个镜头：……（很长的脚本正文）".repeat(5))] as never[], 5, "帮我写一个按摩椅的视频脚本")).toBe(false);
  });
  it("问卷回答之后只说不做也会提醒", () => {
    const messages = [user, say("先确认几个问题", [{ type: "toolCall", id: "q", name: "ask_user", arguments: {} }]),
      { role: "toolResult", toolCallId: "q", toolName: "ask_user", content: [], isError: false }, say("好的，我按竖屏 10 秒来做。")];
    expect(saidButDidNot(messages as never[], 5, "帮我做个宣传视频")).toBe(true);
  });
});

describe("Agent v3 去掉提前宣布的“已完成”", () => {
  it("只保留打算那段", () => {
    const text = "我基于最新这张客厅图处理：去掉按摩椅，其他不变。\n\n已完成：按摩椅已从场景中移除。\n\n接下来可以继续补一个落地灯。";
    expect(stripPrematureCompletion(text)).toBe("我基于最新这张客厅图处理：去掉按摩椅，其他不变。");
  });
  it("没有提前完成的表述时原样保留", () => {
    expect(stripPrematureCompletion("我按 3:4 出 4 版给你挑。")).toBe("我按 3:4 出 4 版给你挑。");
  });
});

describe("Agent v3 提示词里的 @素材", () => {
  const image = { kind: "image" as const }, clip = { kind: "video" as const }, sound = { kind: "audio" as const };
  it("按 refs 顺序、各类型分别编号", () => {
    expect(referenceTokens([image, clip, image, sound])).toEqual(["图片1", "视频1", "图片2", "音频1"]);
  });
  it("统一 @图1、@图 1、@image2 等写法为 @图片N", () => {
    expect(normalizeReferenceTokens("参考@图 1的外观，放进@image2的场景，配@视频 1的运镜", [image, image, clip])).toBe("参考@图片1的外观，放进@图片2的场景，配@视频1的运镜");
  });
  it("只有一张参考图时把“原图/参考图”换成 @图片1", () => {
    expect(normalizeReferenceTokens("保持原图的构图不变，背景参考图中的暖光", [image])).toBe("保持@图片1的构图不变，背景@图片1中的暖光");
  });
  it("有参考素材却没写 @ 时补在开头；文生图不改", () => {
    expect(normalizeReferenceTokens("把背景换成米色", [image], { prefix: true })).toBe("参考@图片1，把背景换成米色");
    expect(normalizeReferenceTokens("镜头缓缓推进", [image])).toBe("镜头缓缓推进");
    expect(normalizeReferenceTokens("雨夜霓虹街道", [], { prefix: true })).toBe("雨夜霓虹街道");
  });
  it("编号超出参考素材数量时报错，提示正确的编号", () => {
    expect(() => normalizeReferenceTokens("参考@图片3", [image, image])).toThrow(/@图片3.*@图片1、@图片2/);
    expect(() => normalizeReferenceTokens("参考@图片1", [])).toThrow(/refs 为空/);
  });
  it("系统规则要求生成提示词用 @素材 引用", () => {
    expect(CREATIVE_AGENT_V3_RULES).toContain("@图片1、@图片2、@视频1、@音频1");
  });
});

import { splitNextSteps } from "@/lib/creative-agent/next-steps";
describe("Agent v3 收尾的下一步选项", () => {
  it("末尾的 <next> 行变成选项，正文里去掉", () => {
    expect(splitNextSteps("海报做好了，主打秋季氛围。\n<next>换成暖色调|出同系列内页｜做成 9:16 视频</next>")).toEqual({ body: "海报做好了，主打秋季氛围。", steps: ["换成暖色调", "出同系列内页", "做成 9:16 视频"] });
  });
  it("流式输出时写了一半的标签先藏起来，不显示选项", () => {
    expect(splitNextSteps("海报做好了。\n<ne")).toEqual({ body: "海报做好了。", steps: [] });
    expect(splitNextSteps("海报做好了。\n<next>换成暖")).toEqual({ body: "海报做好了。", steps: [] });
  });
  it("没有标签时原样返回；正文中间的尖括号不受影响", () => {
    expect(splitNextSteps("比例用 <3:4> 竖版")).toEqual({ body: "比例用 <3:4> 竖版", steps: [] });
  });
  it("系统规则要求用 <next> 给出可点选的下一步", () => {
    expect(CREATIVE_AGENT_V3_RULES).toContain("<next>选项1|选项2|选项3</next>");
  });
});
