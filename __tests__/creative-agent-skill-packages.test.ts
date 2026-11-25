import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { expandCreativeSkillCommand, listCreativeSkills, readCreativeSkill } from "@/lib/creative-agent/skill-packages";
import { createCreativeTools } from "@/lib/creative-agent/tools";
import { buildCreativeSystemPrompt } from "@/lib/creative-agent/skills";
import { HttpError, type Run } from "@/lib/creative-agent/store-types";
import type { CreativeAgentStore } from "@/lib/creative-agent/store";

// Small in-repo fixture standing in for three published system skills.
const catalog = [
  { name: "storyflow", title: "分集制作流程", description: "按阶段整理剧本、资产和分集成果。", files: ["SKILL.md", "references/knowledge/narrativeGenres.md"] },
  { name: "canvas", title: "画布操作手册", description: "读取、创建、修改和定位画布节点。", files: ["SKILL.md"] },
  { name: "workflow", title: "视频制作工作流", description: "把创意制作成文本、图片资产和视频片段。", files: ["SKILL.md", "references/assets.md"] },
];
const bundle = { documents: {
  "storyflow/SKILL.md": { content: "---\nname: storyflow\n---\n# 分集制作流程\n逐阶段确认剧本、资产与分镜。" },
  "storyflow/references/knowledge/narrativeGenres.md": { content: "# 叙事类型\n悬疑、成长、喜剧等类型的节奏要点。" },
  "canvas/SKILL.md": { content: "---\nname: canvas\n---\n# 画布操作手册\n先读取节点，再创建或修改。" },
  "workflow/SKILL.md": { content: "---\nname: workflow\n---\n# SEEDANCE EPISODE DIRECTOR\n从创意到视频片段的完整制作方法。" },
  "workflow/references/assets.md": { content: "# 资产整理\n按入画与复用需求整理角色、场景和道具。" },
} } as const;
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentEnabled: vi.fn(), requireCreativeAgentCanvas: vi.fn() }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: vi.fn() }));
const run = { id: "r", sessionId: "s", actorUserId: 1, canvasId: 1, epoch: 1, input: { selection: { nodeIds: [], edgeIds: [], references: [] } } } as unknown as Run;

vi.mock("@/lib/role-skills/repository", () => ({
  readRoleSkillDocument: vi.fn(), listRoleSkillsForUser: vi.fn(), getPersonalRoleSkill: vi.fn(), getSystemRoleSkillForUser: vi.fn(),
  RoleSkillRepositoryError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
import { readRoleSkillDocument, listRoleSkillsForUser, getPersonalRoleSkill, getSystemRoleSkillForUser, RoleSkillRepositoryError } from "@/lib/role-skills/repository";
const details = catalog.map((skill, index) => ({
  id: `system:${index + 1}`, source: "system" as const, name: `${skill.name} · ${skill.title}`, summary: skill.description,
  category: "创作流程", revision: 1, mediaType: "text" as const, coverUrl: null, usageScenario: "", usageGuide: "", createdAt: "", updatedAt: "",
  content: bundle.documents[`${skill.name}/SKILL.md` as keyof typeof bundle.documents].content,
  workspace: { primaryPath: "SKILL.md", directories: [], files: skill.files.map(path => ({ path, content: bundle.documents[`${skill.name}/${path}` as keyof typeof bundle.documents].content })) },
}));
beforeEach(() => {
  vi.mocked(readRoleSkillDocument).mockImplementation(async input => {
    const skill = input.publicId.startsWith("system:") ? await getSystemRoleSkillForUser(input.publicId) : await getPersonalRoleSkill({ authUserId: input.authUserId, publicId: input.publicId });
    const primaryPath = skill.workspace?.primaryPath || "SKILL.md", selected = input.path || primaryPath;
    if (input.revision !== undefined && input.revision !== skill.revision || selected !== primaryPath && input.revision === undefined) throw new RoleSkillRepositoryError("conflict", "revision");
    const files = skill.workspace?.files || [{ path: primaryPath, content: skill.content }];
    const document = files.find(f => f.path === selected); if (!document) throw new Error("unlisted");
    return { id: skill.id, source: skill.source, name: skill.name, revision: skill.revision, primaryPath, files: files.map(f => f.path), ...document };
  });
  vi.mocked(listRoleSkillsForUser).mockResolvedValue(details);
  vi.mocked(getSystemRoleSkillForUser).mockImplementation(async id => {
    const skill = details.find(skill => skill.id === id);
    if (!skill) throw new RoleSkillRepositoryError("unavailable", "hidden");
    return skill;
  });
});

describe("unified creative Agent skill library", () => {
  it("lists the user's authorized shared catalog without main or reference content", async () => {
    const listed = await listCreativeSkills(41);
    expect(listRoleSkillsForUser).toHaveBeenCalledWith({ authUserId: 41 });
    expect(listed[0]).toMatchObject({ id: "system:1", revision: 1 });
    expect(JSON.stringify(listed)).not.toContain("SEEDANCE EPISODE DIRECTOR");
    expect(listed[0]).not.toHaveProperty("workspace");
  });

  it("expands the selected current main file, preserves user intent and leaves references on demand", async () => {
    const expanded = await expandCreativeSkillCommand("/skill:system:3\n只整理资产，不生成", 41);
    expect(expanded).toContain('"skillId":"system:3"');
    expect(expanded).toContain('"revision":1');
    expect(expanded).toContain("SEEDANCE EPISODE DIRECTOR");
    expect(expanded).not.toContain("metadata:\n");
    expect(expanded.endsWith("只整理资产，不生成")).toBe(true);
    expect(expanded).not.toContain((await readCreativeSkill(41, "system:3", "references/assets.md", 1)).content);
    expect(await expandCreativeSkillCommand("解释 /skill:workflow 怎么使用", 41)).toBe("解释 /skill:workflow 怎么使用");
    expect(await expandCreativeSkillCommand("/skill:workflow", 41)).toContain('"skillId":"system:3"');
  });

  it("shares canonical command parsing without changing personal skill permission checks or the user request", async () => {
    vi.mocked(getPersonalRoleSkill).mockResolvedValue({ ...details[0], id: "personal:21", source: "personal", revision: 5 });
    const expanded = await expandCreativeSkillCommand("/skill:personal:21 需要一张背景图，什么都可以", 41, undefined, 2, 1);
    expect(getPersonalRoleSkill).toHaveBeenCalledWith({ authUserId: 41, publicId: "personal:21" });
    expect(expanded.endsWith("用户要求：\n需要一张背景图，什么都可以")).toBe(true);
    expect(expanded).toContain('"revision":5');
    vi.mocked(getPersonalRoleSkill).mockRejectedValueOnce(new RoleSkillRepositoryError("unavailable", "another account"));
    await expect(expandCreativeSkillCommand("/skill:personal:21 需要一张背景图", 42)).rejects.toMatchObject({ code: "SKILL_UNAVAILABLE" });
  });

  it("reads personal main files and references through the current user's permission check", async () => {
    vi.mocked(getPersonalRoleSkill).mockResolvedValue({ ...details[0], id: "personal:7", source: "personal", revision: 5,
      workspace: { primaryPath: "guide.md", directories: [], files: [{ path: "guide.md", content: "个人技能主文件" }, { path: "ref.md", content: "参考文件" }] } });
    expect(await readCreativeSkill(41, "personal:7")).toMatchObject({ path: "guide.md", content: "个人技能主文件", revision: 5, files: ["guide.md", "ref.md"] });
    expect(getPersonalRoleSkill).toHaveBeenCalledWith({ authUserId: 41, publicId: "personal:7" });
    await expect(readCreativeSkill(41, "personal:7", "ref.md")).rejects.toMatchObject({ code: "SKILL_REVISION_CONFLICT" });
    await expect(readCreativeSkill(41, "personal:7", "ref.md", 4)).rejects.toMatchObject({ code: "SKILL_REVISION_CONFLICT" });
    expect(await readCreativeSkill(41, "personal:7", "ref.md", 5)).toMatchObject({ content: "参考文件" });
    vi.mocked(getPersonalRoleSkill).mockRejectedValueOnce(new RoleSkillRepositoryError("not-found", "another user"));
    await expect(readCreativeSkill(42, "personal:7")).rejects.toMatchObject({ code: "SKILL_UNAVAILABLE" });
  });

  it.each(["../../.env", "/etc/passwd", "https://example.com/skill.md", "references/../SKILL.md", "references/assets.md#heading", "references\\assets.md", "__proto__"])("rejects unlisted resource %s", async file => {
    await expect(readCreativeSkill(41, "system:3", file, 1)).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" });
  });
  it("rejects hidden/deleted skills and ambiguous names instead of using the old static bundle", async () => {
    await expect(readCreativeSkill(41, "system:999")).rejects.toMatchObject({ code: "SKILL_UNAVAILABLE" });
    await expect(expandCreativeSkillCommand("/skill:missing", 41)).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" });
    vi.mocked(listRoleSkillsForUser).mockResolvedValue([details[2], { ...details[2], id: "personal:9" }]);
    await expect(expandCreativeSkillCommand("/skill:workflow", 41)).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" });
  });
  it("keeps skill bodies out of system instructions and states current host mappings", () => {
    const prompt = buildCreativeSystemPrompt(run);
    expect(prompt).toContain("skillOperator(action=list)");
    expect(prompt).toContain("getCanvas/getCanvasNodes/findCanvasNodes → canvas_read");
    expect(prompt).toContain("读取技能不授权付费");
    for (const skill of details) expect(prompt).not.toContain(skill.content);
  });
  it("delivers list and full reference content through real tool execution and persists replayable receipts", async () => {
    const receipts = new Map<string, any>();
    const store = {
      assertFence: vi.fn(), appendEvent: vi.fn(async () => undefined),
      getAction: vi.fn(async (id: string) => { if (!receipts.has(id)) throw new HttpError(404, "action_not_found", "missing"); return receipts.get(id); }),
      claimAction: vi.fn(async (input: any) => { receipts.set(input.actionId, input); return { ...input, claimed: true }; }),
      completeAction: vi.fn(async (id: string, result: any) => receipts.set(id, { ...receipts.get(id), ...result })),
    };
    const execute = vi.fn();
    const tool = createCreativeTools(run, store as unknown as CreativeAgentStore, execute).find(tool => tool.name === "skillOperator")!;
    const list = await tool.execute("list", { action: "list" });
    expect(JSON.parse((list.content[0] as { text: string }).text).skills).toHaveLength(3);
    const args = { action: "read", skillId: "system:1", revision: 1, path: "references/knowledge/narrativeGenres.md" };
    validateToolArguments(tool, { type: "toolCall", id: "read", name: tool.name, arguments: args });
    const read = await tool.execute("read", args);
    expect(JSON.parse((read.content[0] as { text: string }).text).content).toBe((await readCreativeSkill(1, args.skillId, args.path, args.revision)).content);
    expect(store.completeAction).toHaveBeenCalledTimes(2);
    expect(await tool.execute("read", args)).toEqual(read);
    expect(store.completeAction).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(() => validateToolArguments(tool, { type: "toolCall", id: "write", name: tool.name, arguments: { action: "update", name: "workflow", content: "override" } })).toThrow();
    await expect(tool.execute("bad", { action: "read", skillId: "system:3", revision: 1, path: "../../.env" })).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" });
  });
});

it('reports the actual selected-skill read once with user provenance, without an extra body read', async () => {
  const events: any[] = [];
  const before = vi.mocked(readRoleSkillDocument).mock.calls.length;
  await expandCreativeSkillCommand('/skill:system:1 只写三行', 1, async event => { events.push(event); });
  expect(vi.mocked(readRoleSkillDocument).mock.calls.length - before).toBe(1);
  expect(events.map(event => event.status)).toEqual(['running','success']);
  expect(events[1].activity).toMatchObject({selectionOrigin:'user',origin:'input_expansion',skillId:'system:1',name:details[0].name,revision:1});
  expect(JSON.stringify(events)).not.toContain(details[0].content);
});


it('reasserts current host policy after a long selected skill without editing its body or user scope', async () => {
  const body = '方法原文：先询问默认型号，引用内部阶段编号。\n'.repeat(4000);
  vi.mocked(readRoleSkillDocument).mockResolvedValueOnce({id:'system:3',name:'Long workflow',source:'system',revision:5,primaryPath:'SKILL.md',path:'SKILL.md',files:['SKILL.md'],content:body} as any);
  const expanded = await expandCreativeSkillCommand('/skill:system:3\n只做文字方案和完成摘要', 41, undefined, 2);
  const tail = expanded.slice(expanded.indexOf('--- 技能正文结束 ---'));
  expect(expanded).toContain(body.trim());
  expect(tail).toContain('当前宿主执行约束');
  expect(tail).toContain('普通回复和后续建议');
  expect(tail).toContain('内部章节编号');
  expect(tail).toContain('真实缺项');
  expect(tail).toContain('只做文字');
  expect(expanded.endsWith('只做文字方案和完成摘要')).toBe(true);
  expect(vi.mocked(readRoleSkillDocument).mock.calls.at(-1)?.[0]).toEqual({authUserId:41,publicId:'system:3',path:undefined,revision:undefined});
});

it('places the same host policy after on-demand skill content in real v2 tool results and replay', async () => {
  const receipts = new Map<string, any>();
  const owner = {assertFence:vi.fn(),appendEvent:vi.fn(),getAction:vi.fn(async(id:string)=>{if(!receipts.has(id))throw new HttpError(404,'action_not_found','missing');return receipts.get(id);}),claimAction:vi.fn(async(input:any)=>{receipts.set(input.actionId,input);return {...input,claimed:true};}),completeAction:vi.fn(async(id:string,value:any)=>receipts.set(id,{...receipts.get(id),...value}))};
  const current = {...run,input:{...run.input,matchingPolicyVersion:2 as const}};
  const read = createCreativeTools(current,owner as unknown as CreativeAgentStore,vi.fn()).find(t=>t.name==='skillOperator')!;
  const result = await read.execute('long-read',{action:'read',skillId:'system:3'});
  const text=(result.content[0] as {text:string}).text,parsed=JSON.parse(text);
  expect(parsed.content).toBe(details[2].content);
  expect(parsed.hostPolicy).toContain('当前宿主执行约束');
  expect(text.indexOf('hostPolicy')).toBeGreaterThan(text.indexOf('content'));
  expect(await read.execute('long-read',{action:'read',skillId:'system:3'})).toEqual(result);
  expect(owner.completeAction).toHaveBeenCalledTimes(1);
});

it('R26 applies an expanded main while real reference reads still enforce revision and account access', async () => {
  vi.mocked(getPersonalRoleSkill).mockResolvedValue({ ...details[0], id: 'personal:7', source: 'personal', revision: 5,
    workspace: { primaryPath: 'guide.md', directories: [], files: [{ path: 'guide.md', content: '完整方法正文' }, { path: 'references/light.md', content: '实际光线资料' }] } });
  const expanded = await expandCreativeSkillCommand('/skill:personal:7 一张家庭背景图', 41, undefined, 2, 1);
  expect(expanded).toContain('primaryPath 正文已完整加载于本轮');
  expect(expanded).toContain('不要为确认或准备而重复 list/read 同一主文件');
  expect(expanded).toContain('尚未加载的 files 路径');
  expect(expanded).not.toContain('实际光线资料');
  const receipts = new Map<string, any>();
  const owner = { assertFence: vi.fn(), appendEvent: vi.fn(async () => undefined), getAction: vi.fn(async (id: string) => { if (!receipts.has(id)) throw new HttpError(404, 'action_not_found', 'missing'); return receipts.get(id); }), claimAction: vi.fn(async (input: any) => { receipts.set(input.actionId, input); return { ...input, claimed: true }; }), completeAction: vi.fn(async (id: string, value: any) => receipts.set(id, { ...receipts.get(id), ...value })) };
  const execute = vi.fn();
  const tool = createCreativeTools({ ...run, actorUserId: 41, input: { ...run.input, matchingPolicyVersion: 2, mediaAuthorizationVersion: 1 } }, owner as unknown as CreativeAgentStore, execute).find(tool => tool.name === 'skillOperator')!;
  expect(tool.description).toContain('未知或其他技能先 list');
  expect(tool.description).toContain('同一 skillId/revision 主文已完整提供时无需 list/read');
  const args = { action: 'read', skillId: 'personal:7', path: 'references/light.md', revision: 5 };
  const reference = await tool.execute('reference', args);
  expect(JSON.parse((reference.content[0] as { text: string }).text)).toMatchObject({ content: '实际光线资料', path: args.path, primaryPath: 'guide.md', revision: 5 });
  expect(owner.appendEvent).toHaveBeenCalledWith('r', 1, 'tool.completed', expect.objectContaining({ detail: expect.objectContaining({ activity: expect.objectContaining({ operation: 'read', path: args.path, primaryPath: 'guide.md', purpose: '读取技能参考资料' }) }) }));
  await expect(tool.execute('stale', { ...args, revision: 4 })).rejects.toMatchObject({ code: 'SKILL_REVISION_CONFLICT' });
  expect(owner.appendEvent).toHaveBeenLastCalledWith('r', 1, 'tool.completed', expect.objectContaining({ status: 'error', detail: expect.objectContaining({ activity: expect.objectContaining({ path: args.path, purpose: '读取技能资料' }) }) }));
  const main = await tool.execute('recovered-main', { action: 'read', skillId: 'personal:7' });
  expect(JSON.parse((main.content[0] as { text: string }).text)).toMatchObject({ content: '完整方法正文', revision: 5 });
  vi.mocked(getPersonalRoleSkill).mockRejectedValueOnce(new RoleSkillRepositoryError('unavailable', 'another account'));
  await expect(tool.execute('denied', args)).rejects.toMatchObject({ code: 'SKILL_UNAVAILABLE' });
  expect(getPersonalRoleSkill).toHaveBeenLastCalledWith({ authUserId: 41, publicId: 'personal:7' });
  expect(execute).not.toHaveBeenCalled();
});
