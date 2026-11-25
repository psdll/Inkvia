"use client";

import { UiText, UiProps } from "@/i18n/ui";


import * as React from "react";
import { ChevronRight, Images, Video } from "lucide-react";
import type { CreativeAgentMedia, CreativeAgentRunStatus } from "@/lib/creative-agent/contracts";
import type { CreativeAgentMediaPresentation } from "@/lib/creative-agent/media-presentation";
import { summarizeMediaOutcomes } from "@/lib/creative-agent/media-summary";
import { friendlyErrorDisplayText } from "@/lib/error-friendly";
import Markdown, { MarkdownImage } from "./AgentMarkdown";
import styles from "./canvas-agent.module.css";

export function MediaPlan({ media }: { media: CreativeAgentMediaPresentation }) {
  const summary=media.planSummary, whole=summary?.wholePlan;
  // Explicitly cover the user-facing image/video schema; never render arbitrary routing fields.
  const labels:Record<string,string>={aspectRatio:"画幅",ratio:"画幅",resolution:"分辨率",quality:"质量",background:"背景",duration:"时长（秒）",generateAudio:"生成声音",count:"本步骤调用",inputMode:"输入方式",gptImage25Mode:"生成模式",cameraFixed:"固定镜头",watermark:"水印",omniReferenceTaskType:"参考视频用途",outputFormat:"输出格式",seed:"随机种子"};
  const values:Record<string,Record<string,string>>={inputMode:{text_to_video:"文字生成",first_frame:"首帧",first_last_frame:"首尾帧",multimodal:"多种参考素材"},gptImage25Mode:{flare:"普通",sunburst:"高级"},omniReferenceTaskType:{auto:"自动",edit:"编辑",extend:"延长"},outputFormat:{mp4:"MP4",mov:"MOV"}};
  const parameters=Object.entries(media.params).filter(([key,value])=>labels[key] && value !== undefined && value !== "" && ["string","number","boolean"].includes(typeof value)).map(([key,value])=>`${labels[key]}：${typeof value === "boolean" ? value ? "是" : "否" : key === "duration" && value === -1 ? "自动" : values[key]?.[String(value)] ?? value}`).join(" · ");
  return <div className={styles.mediaPlan}>
    <p><strong>{media.model.label}</strong>{summary && <span> · {summary.selectedWhy.some(reason=>reason.includes("指定")) ? <UiText id="common.mb8852ee83d73" /> : <UiText id="common.mcb593b9cbc53" />}</span>}</p>
    <p>{parameters}</p>
    {summary && <>
      <p><UiText id="common.m6c410d4b0241" />{whole?.finalOutputs ?? summary.limits.finalOutputs}<UiText id="common.ma9cb68844b3e" />{whole?.intermediateOutputs ?? summary.limits.intermediateOutputs}<UiText id="common.mff8c55f7a900" /></p>
      <p><UiText id="common.m8d967a84ad0d" />{whole?.initialCalls ?? summary.limits.initialCalls}<UiText id="common.m43c25aad006d" />{summary.limits.retryCalls}<UiText id="common.mf81526efce19" />{summary.limits.totalCalls !== undefined ? <UiText id="common.m9aa55f5f18b7" values={{v0: String(summary.limits.totalCalls)}} /> : ""}</p>
      {whole && <>
        <p><UiText id="common.m6fd6014dd2cc" />{whole.currentStep} / {whole.steps}<UiText id="common.me010e3f578cc" /></p>
        <p>{whole.unreadySteps ? <UiText id="common.m10ba582c5738" values={{v0: String(whole.minReturned), v1: String(whole.unreadySteps)}} /> : <UiText id="common.ma189703e5871" values={{v0: String(whole.maxReturned === undefined ? `至少 ${whole.minReturned} 份，最多返回数未确认` : whole.minReturned === whole.maxReturned ? `${whole.minReturned} 份` : `${whole.minReturned}–${whole.maxReturned} 份`)}} />}</p>
      </>}
      <p><UiText id="common.mcd9b9874b093" />{summary.output.exactReturned !== undefined ? <UiText id="common.m6e394c2ea2aa" values={{v0: String(summary.output.exactReturned)}} /> : summary.output.maxReturned !== undefined ? <UiText id="common.m577225714c7f" values={{v0: String(summary.output.minReturned), v1: String(summary.output.maxReturned)}} /> : <UiText id="common.m85f0604ade5a" values={{v0: String(summary.output.expectedReturned ?? summary.output.minReturned)}} />}</p>
      {summary.limits.totalOutputs !== undefined && <p><UiText id="common.mdc98484f3ab0" />{summary.limits.totalOutputs}<UiText id="common.m4531e95eb3e8" /></p>}
    </>}
    {!!media.references.length && <UiProps ids={{"aria-label":["common.m680bded6386c"]}}><div className={styles.mediaReferences} aria-label="common.m680bded6386c">
      {media.references.map((reference, index) => <figure key={`${reference.nodeId}:${index}`}>
        {reference.kind === "image" ? <MarkdownImage src={reference.url} alt={reference.label || `参考图 ${index + 1}`} /> : <span>{reference.kind === "video" ? <UiText id="common.mc20f7618d330" /> : <UiText id="common.m296c632ec857" />}<UiText id="common.mc6f305e9b180" /></span>}
        <figcaption>{reference.label || <UiText id="common.m4e7b27c1c44b" values={{v0: String(index + 1)}} />}</figcaption>
      </figure>)}
    </div></UiProps>}
    <details><summary><UiText id="common.m7d0451106c2d" /></summary><p>{parameters}</p><Markdown text={media.prompt} /></details>
  </div>;
}

export type AgentMediaReference = { nodeId: string; generationId: number; mediaType: "image" | "video" };
type ReferenceHandler = (reference: AgentMediaReference) => void;

function MediaGroup({ media, onLocate, onReference, settled }: { media: CreativeAgentMedia[]; onLocate: (id: string) => void; onReference?: ReferenceHandler; settled: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const galleryId = React.useId();
  const video = media[0].mediaType === "video";
  const kind = video ? "视频" : "图片";
  const outputs = media.flatMap(item => item.outputs.map((output, index) => ({
    ...output, nodeId: output.nodeId || (item.outputs.length === 1 && item.nodeIds.length === 1 ? item.nodeIds[0] : undefined), generationId: output.generationId || item.generationId, key: `${item.generationId}:${output.generationId ?? ""}:${output.nodeId ?? ""}:${output.url}`,
  })));
  const multiple = outputs.length > 1;
  const label = `${kind}已生成${multiple ? ` ×${outputs.length}` : ""}`;
  const Icon = video ? Video : Images;
  return <section className={styles.mediaGallery} aria-label={`${kind}生成结果`}>
    {!!outputs.length && <>
      {multiple ? <button type="button" data-agent-expand className={styles.mediaHeading} aria-expanded={expanded} aria-controls={galleryId} onClick={() => setExpanded(value => !value)}>
        <Icon size={14} /><span>{label}</span><ChevronRight size={14} className={expanded ? styles.mediaChevronOpen : undefined} />
      </button> : <div className={styles.mediaHeading}><Icon size={14} /><span>{label}</span></div>}
      <div id={galleryId}>
        {multiple && !expanded ? <UiProps ids={{"title":["common.m96bcf3019cf5","common.m082ea63d8064"]}}><button type="button" className={styles.mediaStack} disabled={!outputs[0].nodeId} aria-label={outputs[0].nodeId ? `定位${kind} 1 到画布` : `${kind}缩略图`} title={outputs[0].nodeId ? "common.m96bcf3019cf5" : "common.m082ea63d8064"} onClick={() => { if (outputs[0].nodeId) onLocate(outputs[0].nodeId); }}>
          <span className={styles.mediaStackBack} aria-hidden="true" />
          <span className={styles.mediaStackBack} aria-hidden="true" />
          <span className={styles.mediaStackCover}>
            {video ? <video src={outputs[0].url} muted preload="metadata" /> : <img src={outputs[0].url} alt="" loading="lazy" />}
            <span className={styles.mediaCount}>+{outputs.length - 1}</span>
          </span>
        </button></UiProps> : <div className={styles.mediaGrid} data-single={!multiple || undefined}>
          {outputs.map((output, index) => <div key={output.key} className={styles.mediaTile} style={{ aspectRatio: output.width && output.height ? `${output.width} / ${output.height}` : "4 / 3" }}>
            {video ? <video src={output.url} controls controlsList="nodownload" preload="metadata" /> : <UiProps ids={{"title":["common.m96bcf3019cf5","common.m082ea63d8064"]}}><button type="button" className={styles.mediaLocateImage} disabled={!output.nodeId} aria-label={output.nodeId ? `定位图片 ${index + 1} 到画布` : `图片 ${index + 1}`} title={output.nodeId ? "common.m96bcf3019cf5" : "common.m082ea63d8064"} onClick={() => { if (output.nodeId) onLocate(output.nodeId); }}><img src={output.url} alt={`图片 ${index + 1}`} loading="lazy" /></button></UiProps>}
            {onReference && output.nodeId && <button type="button" className={styles.mediaReference} aria-label={`引用${kind} ${index + 1}`} onClick={() => onReference({ nodeId: output.nodeId!, generationId: output.generationId, mediaType: video ? "video" : "image" })}><UiText id="common.me0ec651f0dae" /></button>}
          </div>)}
        </div>}
      </div>
    </>}
    {!settled && media.filter(item => item.status !== "success" && !media.some(retry => retry.retryOfGenerationId === item.generationId)).map(item => <p key={item.generationId} role="status" className={styles.mediaStatus}>
      {item.retryOfGenerationId ? <><UiText id="common.m8da5231bcd46" />{friendlyErrorDisplayText(item.retryReason || "服务未返回具体原因")}；{["failed", "cancelled", "canceled"].includes(item.status) ? <UiText id="common.m8dbd3bec004e" values={{v0: String(friendlyErrorDisplayText(item.error || (item.status === "failed" ? "再次失败，已停止自动重试" : "已取消")))}} /> : <UiText id="common.m09c97a9bc439" />}</> : friendlyErrorDisplayText(item.error || (["failed", "cancelled", "canceled"].includes(item.status) ? `${kind}生成未完成` : `${kind}生成中…`))}
    </p>)}
  </section>;
}

export function AgentMediaGallery({ media, onLocate, onReference, settled = false, runStatus }: { media: CreativeAgentMedia[]; onLocate: (id: string) => void; onReference?: ReferenceHandler; settled?: boolean; runStatus?: CreativeAgentRunStatus }) {
  const summary = settled ? summarizeMediaOutcomes(media, runStatus) : null;
  return <>{(["image", "video"] as const).map(type => {
    const items = media.filter(item => item.mediaType === type);
    return items.length ? <MediaGroup key={type} media={items} onLocate={onLocate} onReference={onReference} settled={Boolean(summary)} /> : null;
  })}{summary && <UiProps ids={{"aria-label":["common.m351a0311c855"]}}><section className={styles.message} aria-label="common.m351a0311c855"><Markdown text={summary} /></section></UiProps>}</>;
}
