# 生成服务与素材引用

新页面、任务或后台工作流通过 `createImageGeneration` / `createVideoGeneration` 提交生成任务。不要在页面中选择模型引用格式，也不要绕过生成服务直接调用供应商适配器。

调用方提交原始生成提示词（保留 `@图片1` 等标记）和按界面顺序排列的素材。混合工具素材与素材库路径时，传入现有 `inputManifest`，由服务还原统一顺序。`userPrompt` 用于保留角色技能处理前的用户输入，与实际生成 `prompt` 分开。

`prompt-references.ts` 是生成模型引用规则的唯一入口：

| 模型 | 使用有效 @素材 | 未使用有效 @素材 |
| --- | --- | --- |
| 全部图片模型 | 转为 `图片N` | 原文提交 |
| Seedance 2.0 系列（含 Face）、MiniMax H3 系列 | 转为中文分类编号 | 原文提交 |
| Seedance 2.5 | 转为 `@imageN` / `@videoN` / `@audioN` | 原文提交 |
| 其他视频模型 | 附带参考素材编号说明 | 原文提交 |

图片、视频、音频、人像分别编号。`@` 只控制提示词引用，不按提及先后重排素材，也不剔除未提及的素材。未知编号保持原文；完整匹配编号，避免 `@图片1` 误改 `@图片10`。已转换的历史提示词保持兼容。

图片服务使用还原顺序后的图片输入编译提示词；视频服务在 `createVideoRecord` 内使用锁定后的实际素材类型与顺序编译。保存记录和供应商请求使用同一份结果。

画布互换素材时先用共享编辑器引用匹配规则更新标记，保持引用对象不变，再保存 `referenceOrder`。画布、创作页和工作流均向生成服务传入原始生成提示词，不自行追加参考说明。

角色技能和画布文本生成的 LLM 上下文继续使用底层共享 `buildPromptWithAssetReferences`。它们不是图片、视频模型请求，不选择图片或视频生成模型的格式。

更改生成模型规则时修改 `generationReferenceFormat`，并运行 `__tests__/generation-prompt-references.test.ts`、`__tests__/tool-media-integration.test.ts` 和 `__tests__/video-tool-media-validation.test.ts`。模型目录测试覆盖当前全部图片、视频模型，服务测试覆盖 tool、canvas、agent、batch 来源。
