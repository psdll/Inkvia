"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Check, ChevronRight, CircleAlert, CircleDashed, LocateFixed, MessageSquare } from "lucide-react";
import type { CreativeAgentMedia } from "@/lib/creative-agent/contracts";
import { creativeSkillActivityLabel } from "@/lib/creative-agent/tool-presentation";
import { friendlyErrorDisplayText } from "@/lib/error-friendly";
import { imageOutputsPerRequest } from "@/lib/creative-agent/v3/model-profiles";
import type { AgentTool } from "./state";
import styles from "./canvas-agent.module.css";

/** “1分2秒” / “36秒” */
export function formatElapsed(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60 ? `${seconds % 60}秒` : ""}` : `${seconds}秒`;
}

const FAILED = new Set(["failed", "cancelled", "canceled"]);
/** 对话里的结果卡只需小图：本地素材走缩略图服务（落盘缓存、浏览器长期缓存），不每次下载几 MB 的原图 */
const thumb = (url: string, poster = false) => url.startsWith("/uploads/") ? `/api/thumb?src=${encodeURIComponent(url)}&w=600${poster ? "&poster=1" : ""}` : undefined;
/** 结果卡里只放一句话的失败原因，完整信息放在悬停提示里 */
function shortError(raw: string) {
  const text = friendlyErrorDisplayText(raw);
  if (/insufficient (account )?balance|余额不足|欠费|arrear/i.test(text)) return "服务商账户余额不足";
  return text.split(/\s*[\[【](?:建议|原始错误)[\]】]/)[0].replace(/^message=/i, "").trim().slice(0, 48) || "生成未完成";
}

/** 一个处理步骤：图标 + 标题 + 简短结果，展开可看细节 */
export function AgentStep({ tool, running, onLocate, extra }: { tool: AgentTool; running: boolean; onLocate: (nodeId: string) => void; extra?: React.ReactNode }) {
  const { label: uiLabel } = useUiLocale();
  const failed = tool.status === "failed" && !running;
  const pending = tool.status === "running" && running;
  const icon = failed ? <CircleAlert size={14} aria-hidden="true" /> : pending ? <CircleDashed size={14} className={styles.stepSpin} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />;
  // 新版步骤带一句简短结果（如“nano-banana-pro · 1/1 已完成”）；旧记录沿用原有状态文字
  const v3 = tool.id.startsWith("v3_");
  const short = v3 && tool.detail && tool.detail.length <= 40 ? tool.detail : "";
  const note = pending ? "" : failed ? (short || tool.outcomeLabel || (v3 ? "未完成" : "操作未完成")) : short || tool.outcomeLabel || "已完成";
  return <details className={styles.step} data-failed={failed || undefined}>
    <summary>
      <ChevronRight size={13} className={styles.disclosure} aria-hidden="true" />
      {icon}
      <span className={styles.stepTitle}>{tool.activity ? uiLabel(creativeSkillActivityLabel(tool.activity, tool.status)) : tool.title}</span>
      {note && <span className={styles.stepNote}>{note}</span>}
    </summary>
    <div className={styles.toolBody}>
      {tool.activity ? <p>{tool.activity.selectionOrigin === "user" ? <UiText id="common.m27d27d0604d3" /> : tool.activity.selectionOrigin === "agent" ? <UiText id="common.ma78956f66a35" /> : <UiText id="common.m9e6774f75ccf" />} · {tool.activity.purpose}{tool.activity.revision ? <UiText id="common.m6b6a92346063" values={{v0: String(tool.activity.revision)}} /> : ""}</p> : null}
      {tool.detail && tool.detail !== note ? <p>{tool.detail}</p> : !tool.activity && <p>{tool.title}</p>}
      {extra}
      {tool.nodeIds.slice(0, 6).map(id => <button type="button" className={styles.locate} key={id} onClick={() => onLocate(id)}><LocateFixed size={12} /><UiText id="common.m40f3d57caa0c" /></button>)}
    </div>
  </details>;
}

/** 问卷回答记录（历史里保留用户的选择，可展开回看） */
export function AnsweredQuestion({ tool }: { tool: AgentTool }) {
  const decision = tool.decision!;
  return <section className={styles.answeredDecision}>
    <details>
      <summary><MessageSquare size={14} strokeWidth={1.5} /><span>{decision.skipped ? <UiText id="common.mc9bb70bcaaa3" /> : <UiText id="common.m39e04c02454d" />}</span><ChevronRight size={13} /></summary>
      {decision.items?.length ? <ul className={styles.stepAnswers}>{decision.items.map((item, index) => <li key={index}><span>{item.question}</span><strong>{item.answer}</strong></li>)}</ul> : <p>{decision.answer}</p>}
    </details>
  </section>;
}

/**
 * 处理过程：说明文字与步骤按时间穿插。运行中全部展开；结束后只把步骤折叠到“已处理 X秒”里，
 * 说明文字原地保留，前后看到的内容与顺序一致。没有步骤的轮次不显示折叠开关。
 */
export function ProcessBlock({ active, elapsed, children, empty, collapsible }: { active: boolean; elapsed: string; children: React.ReactNode; empty: boolean; collapsible: boolean }) {
  const [open, setOpen] = React.useState(false);
  if (empty) return null;
  const toggle = !active && collapsible;
  return <UiProps ids={{"aria-label":["common.m70f30344c57a"]}}><div className={styles.process} data-live={active || undefined} data-collapsed={(toggle && !open) || undefined} aria-label="common.m70f30344c57a">
    {toggle && <button type="button" data-agent-expand className={styles.processToggle} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span>{elapsed ? <UiText id="common.m4ee621f3178a" values={{v0: String(elapsed)}} /> : <UiText id="common.m561435652330" />}</span><ChevronRight size={13} className={open ? styles.mediaChevronOpen : undefined} />
    </button>}
    {children}
  </div></UiProps>;
}

/** 处理过程里的一个步骤（折叠时隐藏） */
export function ProcessItem({ children }: { children: React.ReactNode }) {
  return <div className={styles.processItem}>{children}</div>;
}

/** 生成结果卡：每个版本一格，显示版本名和模型；生成中显示占位 */
export function ResultGallery({ media, modelLabel, onLocate }: { media: CreativeAgentMedia[]; modelLabel: (id: string) => string; onLocate: (nodeId: string, target?: { outputIndex?: number }) => void }) {
  const { label: uiLabel } = useUiLocale();
  if (!media.length) return null;
  const superseded = new Set(media.flatMap(item => item.retryOfGenerationId ? [item.retryOfGenerationId] : []));
  const items = media.filter(item => !superseded.has(item.generationId));
  type Tile = { key: string; item: CreativeAgentMedia; output?: CreativeAgentMedia["outputs"][number]; nodeId?: string; part?: string; outputIndex?: number };
  const tiles: Tile[] = items.flatMap((item): Tile[] => {
    // 一次出多张的模型（如 Midjourney 固定 4 张）：生成中按实际张数占位，出图后按序号区分
    if (item.status === "success" && item.outputs.length) return item.outputs.map((output, index) => ({ key: `${item.generationId}:${index}`, item, output, nodeId: output.nodeId || item.nodeIds[index] || item.nodeIds[0], part: item.outputs.length > 1 ? ` ${index + 1}` : "", outputIndex: item.outputs.length > 1 ? index : undefined }));
    const expected = item.mediaType === "image" && !FAILED.has(item.status) ? imageOutputsPerRequest(item.model) : 1;
    return Array.from({ length: expected }, (_, index) => ({ key: `${item.generationId}:${index}`, item, nodeId: item.nodeIds[0], part: expected > 1 ? ` ${index + 1}` : "" }));
  });
  const single = tiles.length === 1;
  return <UiProps ids={{"aria-label":["common.m519c68235df6","common.ma5b03d3d4dcc"]}}><section className={styles.resultGallery} data-single={single || undefined} aria-label={tiles.every(tile => tile.item.mediaType === "video") ? "common.m519c68235df6" : "common.ma5b03d3d4dcc"}>
    {tiles.map(({ key, item, output, nodeId, part, outputIndex }, index) => {
      const video = item.mediaType === "video";
      const failed = FAILED.has(item.status);
      const ratio = output?.width && output?.height ? `${output.width} / ${output.height}` : video ? "16 / 9" : "3 / 4";
      return <figure key={key} className={styles.resultTile}>
        <div className={styles.resultFrame} style={{ aspectRatio: ratio }} data-state={output ? "done" : failed ? "failed" : "pending"}>
          {output ? (video ? <video src={output.url} poster={thumb(output.url, true)} controls controlsList="nodownload" preload="none" />
            : <UiProps ids={{"title":["common.m96bcf3019cf5"]}}><button type="button" disabled={!nodeId} aria-label={`定位图片 ${index + 1} 到画布`} title={nodeId ? "common.m96bcf3019cf5" : undefined} onClick={() => { if (!nodeId) return; if (outputIndex != null) onLocate(nodeId, { outputIndex }); else onLocate(nodeId); }}>
              <UiProps ids={{"alt":["common.ma78c1924def7"]}}><img src={thumb(output.url) ?? output.url} alt={item.title || "common.ma78c1924def7"} loading="lazy" decoding="async" onError={event => { if (event.currentTarget.src !== new URL(output.url, location.href).href) event.currentTarget.src = output.url; }} /></UiProps></button></UiProps>)
            : failed ? <span className={styles.resultError} title={friendlyErrorDisplayText(item.error || "生成未完成")}>{shortError(item.error || "生成未完成")}</span>
            : <span className={styles.resultPending}>{video ? <UiText id="common.mf2a18c20aeb9" /> : <UiText id="common.m43d2661b36be" />}</span>}
        </div>
        <figcaption>
          {item.title && <strong>{item.title}{part}</strong>}
          <span>{uiLabel(modelLabel(item.model))}</span>
        </figcaption>
      </figure>;
    })}
  </section></UiProps>;
}
