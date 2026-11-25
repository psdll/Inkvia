// SKILL.md 编辑区的引导模板，只作为占位提示，不会写入技能内容。
export const SKILL_MARKDOWN_TEMPLATE_BODY = [
  "## 做什么",
  "（一句话说明用途）例：把一句话故事想法做成一条短漫剧成片",
  "",
  "## 需要什么输入",
  "（最少提供什么）例：一句话想法，可选画风、时长、主角设定",
  "",
  "## 怎么做",
  "（写你在意的环节和要求，不用写全）例：脚本要反转多，画风固定成韩漫",
  "",
  "## 产出什么",
  "（最终交付什么）例：成片，附脚本和分镜",
  "",
  "## 什么时候问你",
  "（什么情况下停下来问你）例：拿不准题材或风格时问一次，其余自己定",
].join("\n");

export const SKILL_MARKDOWN_NEW_HINT = "输入 Skill 内容，或上传 SKILL.md 文件直接替换";
export const SKILL_MARKDOWN_EDIT_HINT = "输入当前 Skill 文件内容";

export const SKILL_MARKDOWN_NEW_PLACEHOLDER = `${SKILL_MARKDOWN_NEW_HINT}\n\n${SKILL_MARKDOWN_TEMPLATE_BODY}`;
export const SKILL_MARKDOWN_EDIT_PLACEHOLDER = `${SKILL_MARKDOWN_EDIT_HINT}\n\n${SKILL_MARKDOWN_TEMPLATE_BODY}`;
