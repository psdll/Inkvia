"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import { sentReferenceSegments } from "./sent-reference-segments";

import * as React from "react";
import CreationPreferencesPanel, { creationPreferencesConflict, type CreationModelCatalog, type CreationPreferenceTab } from "./CreationPreferencesPanel";
import { subscribeToolboxModelVisibilityChanged } from "@/lib/toolbox-model-visibility-events";
import { creationPreferencesKey, emptyCreationPreferences, readCreationPreferences, saveCreationPreferences, type CreationPreferences } from "./creation-preferences-cache";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import {
  ArrowDown,
  AtSign,
  ChevronDown,
  ChevronRight,
  Copy,
  History,
  MessageSquare,
  Plus,
  PanelRight,
  PanelsTopLeft,
  Paperclip,
  Pencil,
  Play,
  SlidersHorizontal,
  ArrowUp,
  Check,
  CircleAlert,
  LocateFixed,
  RotateCcw,
  Square,
  WifiOff,
  X,
} from "lucide-react";
import {
  isCreativeAgentRunActive,
  type CreativeAgentCanvasContext,
  type CreativeAgentReference,
  type CreativeAgentRunStatus,
  type CreativeAgentSelection,
} from "@/lib/creative-agent/contracts";
import { AgentUsage, ContextRing, contextUsage } from "./AgentUsage";
import { LLM_THINKING_LABELS } from "@/lib/llm-routing/reasoning";
import { MediaPlan } from "./AgentMedia";
import { AgentStep, AnsweredQuestion, ProcessBlock, ProcessItem, ResultGallery, formatElapsed } from "./AgentTurn";
import { creativeAgentReferenceKey, mergeCreativeAgentReferences } from "@/lib/creative-agent/canvas-selection";
import AgentMaterialLibraryPicker from "./AgentMaterialLibraryPicker";
import AgentReferenceThumbnail from "./AgentReferenceThumbnail";
import type { ReferencePreview } from "./reference-preview";
import { createPromptAssetMentionPattern, PROMPT_TEXT_ASSET_KIND, type PromptReferenceAsset } from "@/lib/prompt-asset-references";
import { personalMaterialUrl, personalMaterialPreviewUrl, type PersonalMaterial } from "@/lib/canvas/personal-library-types";
import { MediaImage } from "@/components/ui/media-image";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRoleSkillCatalog } from "@/hooks/use-role-skill-catalog";
import { useRoleSkillFavorites } from "@/hooks/use-role-skill-favorites";
import { RoleSkillDialog } from "@/components/role-skills/role-skill-dialog";
import { RoleSkillPicker, type RoleSkillPickerSource } from "@/components/role-skills/role-skill-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deletePersonalRoleSkillClient } from "@/lib/role-skills/client";
import { RoleSkillTag, roleSkillTagClassName } from "@/components/role-skills/role-skill-tag";
import { SkillModuleIcon } from "@/components/ui/creation-icons";
import { PromptRichEditor } from "@/components/ui/prompt-rich-editor";
import { editorDocToPromptText, findPromptAssetMentions, ASSET_MENTION_NODE_NAME, type PromptRichEditorDoc } from "@/lib/prompt-rich-editor-content";
import type { RoleSkillListItem } from "@/lib/role-skills/contracts";
import { useCreativeAgent } from "./use-creative-agent";
import { describeAgentActivity } from "./activity";
import type { AgentDecision, AgentTool } from "./state";
import type { DecisionAnswer } from "@/lib/creative-agent/questions";
import QuestionForm from "./QuestionForm";
import Markdown from "./AgentMarkdown";
import { TurnRail } from "./TurnRail";
import { splitNextSteps } from "@/lib/creative-agent/next-steps";
import { buildTurnCopyText, getTurnFinishedAt } from "./turn-result";
import styles from "./canvas-agent.module.css";
import { useConversationTabs, type ConversationTabs } from "./use-conversation-tabs";
import { AgentConversationTitle } from "./AgentConversationTitle";
import AgentMark from "./AgentMark";

export type CanvasAgentPanelProps = {
  canvasId: number;
  selection: CreativeAgentSelection;
  onPrepareMessage: () => Promise<CreativeAgentCanvasContext>;
  onCanvasCommitted: () => Promise<void>;
  onLocateNode: (nodeId: string, target?: { outputIndex?: number }) => void;
  onClose: () => void;
  visible?: boolean;
  docked?: boolean;
  onToggleDock?: () => void;
  onGetReferences?: () => CreativeAgentReference[];
  onGetReferencePreview?: (reference: CreativeAgentReference) => ReferencePreview | undefined;
  onActiveSessionChange?: (sessionId: string | null) => void;
  onRunningChange?: (running: boolean) => void;
};
const statusLabel: Record<CreativeAgentRunStatus, string> = {
  queued: "等待执行",
  running: "正在创作",
  waiting_decision: "等待你的决定",
  waiting_action: "等待操作结果",
  paused: "已暂停",
  stopping: "正在停止",
  completed: "本轮已完成",
  stopped: "已停止",
  failed: "本轮执行失败",
};
/** 短视频平台的分享链接：这些平台不开放第三方读取视频，需要用户保存到本地后上传 */
const platformVideoLink = /(?:douyin\.com|iesdouyin\.com|xhslink\.com|xiaohongshu\.com|kuaishou\.com|chenzhongtech\.com|b23\.tv|bilibili\.com|ixigua\.com|toutiao\.com|channels\.weixin\.qq\.com)\//i;
// Preparation and inspection remain in the event log and Agent debug inspector.
const internalToolNames = new Set(["user.ask"]);

/** 删掉指定的素材标签及其相邻的一个空格（优先删后面的空格，没有就删前面的） */
function removeMentionTokens(value: string, tokens: string[]) {
  let result = value;
  const matches = [...value.matchAll(createPromptAssetMentionPattern(tokens))].reverse();
  for (const match of matches) {
    let start = match.index!, end = start + match[0].length;
    if (result[end] === " ") end += 1;
    else if (start > 0 && result[start - 1] === " ") start -= 1;
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
}

function splitSkillPrompt(value: string) {
  const command = value.match(/^\s*\/skill:(\S+)(?:\s|$)/);
  return {
    skillId: command?.[1] ?? null,
    text: command ? value.slice(command[0].length) : value,
  };
}

function ReferenceChips({
  references,
  onLocateNode,
}: {
  references: CreativeAgentReference[];
  onLocateNode: (id: string) => void;
}) {
  const { text } = useUiLocale();
  return (
    <div className={styles.chips}>
      {references.map((reference, index) => (
        <button
          type="button"
          key={`${reference.nodeId}:${reference.outputId ?? reference.batchId ?? index}`}
          className={styles.chip}
          title={`${reference.label} · ${reference.outputId ? text("workspaceFollowup.m55ec3b979ac7", { v0: reference.outputId }) : reference.batchId ? text("workspaceFollowup.m26ba4ed0ccc0", { v0: reference.batchId }) : text("workspaceFollowup.m77b1beecd7ff")}`}
          onClick={() => onLocateNode(reference.nodeId)}
        >
          <LocateFixed size={12} aria-hidden="true" />
          <span>{reference.label}</span>
          {reference.outputId && <small><UiText id="common.mfb04addb4c26" /></small>}
        </button>
      ))}
    </div>
  );
}

function isQuestion(decision: AgentDecision) {
  return !decision.media && (Boolean(decision.fields?.length) || !decision.options.some(option => option.value === "approve" || option.value === "cancel"));
}

function DecisionCard({
  decision,
  busy,
  online,
  onAnswer,
}: {
  decision: AgentDecision;
  busy: boolean;
  online: boolean;
  onAnswer: (answer: DecisionAnswer) => Promise<boolean | void>;
}) {
  const { label: uiLabel } = useUiLocale();
  const [answer, setAnswer] = React.useState("");
  const [revising, setRevising] = React.useState(false);
  const [revision, setRevision] = React.useState("");
  const [expired, setExpired] = React.useState(() =>
    Boolean(decision.expiresAt && Date.parse(decision.expiresAt) <= Date.now()),
  );
  React.useEffect(() => {
    if (!decision.expiresAt) return;
    const remaining = Date.parse(decision.expiresAt) - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      return;
    }
    const timer = setTimeout(
      () => setExpired(true),
      Math.min(remaining, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [decision.expiresAt]);
  const disabled = busy || !online || expired;
  if (isQuestion(decision)) {
    const fields = decision.fields?.length ? decision.fields : [{ id: "answer", title: decision.question || decision.title, type: decision.options.length ? "radio" as const : "textarea" as const, required: true, ...(decision.options.length ? { options: decision.options } : {}) }];
    return <UiProps ids={{"aria-label":["common.m5db4fc3ba55b"]}}><section className={styles.questionDecision} aria-label="common.m5db4fc3ba55b">
      <span className={styles.srOnly}>{decision.title}</span>
      {expired ? <p role="status"><UiText id="common.mecf6c2fd0043" /></p> : <QuestionForm id={decision.id} proposalHash={decision.proposalHash} fields={fields} disabled={disabled} allowNote={Boolean(decision.fields?.length)} onAnswer={answer => onAnswer(decision.fields?.length || typeof answer === "string" || !("values" in answer) ? answer : String(answer.values.answer || ""))} />}
    </section></UiProps>;
  }
  return (
    <UiProps ids={{"aria-label":["common.m5db4fc3ba55b"]}}><section className={styles.decision} aria-label="common.m5db4fc3ba55b">
      <span className={styles.eyebrow}><UiText id="common.m0eb236559be9" /></span>
      <h3>{decision.title}</h3>
      {decision.question && <Markdown text={decision.question} />}
      {decision.media && <MediaPlan media={decision.media} />}
      {expired ? (
        <p role="status"><UiText id="common.mdfcdd030adfa" /></p>
      ) : revising ? (
        <form className={styles.revisionForm} onSubmit={event => {
          event.preventDefault();
          if (!disabled && revision.trim()) void onAnswer({ revision: revision.trim() });
        }}>
          <label htmlFor={`revision-${decision.id}`}><UiText id="common.md4f329381820" /></label>
          <UiProps ids={{"aria-label":["common.m28c29060ccc3"],"placeholder":["common.m8c99ef83e554"]}}><textarea id={`revision-${decision.id}`} aria-label="common.m28c29060ccc3" value={revision} maxLength={4000} rows={4} autoFocus disabled={disabled} onChange={event => setRevision(event.target.value)} placeholder="common.m8c99ef83e554" /></UiProps>
          <p><UiText id="common.m67beff106627" /></p>
          <div className={styles.decisionOptions}>
            <button type="submit" disabled={disabled || !revision.trim()}>{busy ? <UiText id="common.m26ef00b7d061" /> : <UiText id="common.m541d8537efda" />}</button>
            <button type="button" disabled={disabled} onClick={() => setRevising(false)}><UiText id="common.m95c5f1199fba" /></button>
          </div>
        </form>
      ) : decision.fields?.length ? (
        <QuestionForm id={decision.id} proposalHash={decision.proposalHash} fields={decision.fields} disabled={disabled} onAnswer={onAnswer} />
      ) : decision.options.length ? (
        <div className={styles.decisionOptions}>
          {decision.options.map((option) => (
            <button
              type="button"
              key={option.value}
              disabled={disabled}
              onClick={() => void onAnswer(option.value)}
            >
              {uiLabel(option.label)}
            </button>
          ))}
          {decision.media && <button type="button" disabled={disabled} onClick={() => setRevising(true)}><UiText id="common.mee64e173d0b6" /></button>}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onAnswer(answer);
          }}
        >
          <label className={styles.srOnly} htmlFor={`decision-${decision.id}`}><UiText id="common.me5a8c445a891" /></label>
          <UiProps ids={{"placeholder":["common.me5a8c445a891"]}}><input
            id={`decision-${decision.id}`}
            value={answer}
            disabled={disabled}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="common.me5a8c445a891"
          /></UiProps>
          <button type="submit" disabled={disabled || !answer.trim()}><UiText id="common.m36f33adaf094" /></button>
        </form>
      )}
    </section></UiProps>
  );
}

type Menu = "history" | "mentions" | "skills" | "context" | null;
// Remember the last tab until the page reloads, scoped to the account and canvas.
const mentionScopes = new Map<string, string>();
const skillTabs = new Map<string, RoleSkillPickerSource>();
type Attachment = {
  id: string;
  name: string;
  type: string;
  url: string;
  size: number;
  status: "uploading" | "ready" | "error";
  serverId?: string;
  coverage?: string;
  error?: string;
  materialId?: string;
  thumbnailUrl?: string;
};
function IconButton({
  label,
  tooltip = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tooltip?: boolean }) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      title={tooltip ? undefined : label}
      data-tooltip={tooltip ? label : undefined}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}

/** Mirrors what the server accepts, so the file picker offers scripts (.md) alongside media. */
const AGENT_ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp,video/*,audio/*,.md,.markdown,.txt,.json,.csv,text/markdown,text/plain,application/json,text/csv";
function isAgentTextDocument(file: File) {
  return ["text/plain", "text/markdown", "application/json", "text/csv"].includes(file.type) || /\.(txt|md|markdown|json|csv)$/i.test(file.name);
}

export default function CanvasAgentPanel(props: CanvasAgentPanelProps) {
  return <CanvasAgentWorkspace key={props.canvasId} {...props} />;
}

function CanvasAgentWorkspace(props: CanvasAgentPanelProps) {
  const { error: uiError } = useUiLocale();
  const tabs = useConversationTabs(props.canvasId);
  const [runningSessions, setRunningSessions] = React.useState<Record<string, boolean>>({});
  const reportRunning = React.useCallback((sessionId: string, running: boolean) => {
    setRunningSessions(current => Boolean(current[sessionId]) === running ? current : { ...current, [sessionId]: running });
  }, []);
  const running = Object.values(runningSessions).some(Boolean);
  const { onRunningChange } = props;
  React.useEffect(() => { onRunningChange?.(running); }, [running, onRunningChange]);
  React.useEffect(() => { props.onActiveSessionChange?.(tabs.activeId); }, [tabs.activeId, props.onActiveSessionChange]);
  return (
    <>
      {!tabs.activeId && (
        <UiProps ids={{"aria-label":["common.meece942862ef"]}}><aside className={styles.panel} aria-label="common.meece942862ef">
          <header className={styles.header} data-agent-drag>
            <div className={styles.conversationHeading}><UiText id="common.mb814682299f0" /></div>
            <div className={styles.headerActions}>
              <UiProps ids={{"label":["common.m6897a8ef070b"]}}><IconButton label="common.m6897a8ef070b" disabled={!tabs.ready || tabs.creating} onClick={() => void tabs.create()}>
                <Plus size={16} />
              </IconButton></UiProps>
              <UiProps ids={{"label":["common.m51b20d2e278e"]}}><IconButton label="common.m51b20d2e278e" onClick={() => void tabs.refresh()}><History size={16} /></IconButton></UiProps>
              <UiProps ids={{"label":["common.m24ea12474c81"]}}><IconButton label="common.m24ea12474c81" onClick={props.onClose}><X size={16} /></IconButton></UiProps>
            </div>
          </header>
          {tabs.error && <p className={styles.notice} role="alert">{uiError(tabs.error)}</p>}
          <div className={styles.emptyWelcome}>
            <h3>{tabs.ready ? <UiText id="common.m670d9743542c" /> : <UiText id="common.m8cb83e6faa1c" />}</h3>
            <p><UiText id="common.m7d61328c3237" /></p>
            {tabs.sessions.filter(session => session.messageCount > 0).map(session => (
              <button type="button" className={styles.menuItem} key={session.id} onClick={() => tabs.open(session.id)}>{session.title}</button>
            ))}
          </div>
        </aside></UiProps>
      )}
      {tabs.mountedIds.map(sessionId => (
        <CanvasAgentConversation
          key={sessionId}
          {...props}
          sessionId={sessionId}
          tabs={tabs}
          onConversationRunningChange={reportRunning}
          visible={props.visible !== false && tabs.activeId === sessionId}
        />
      ))}
    </>
  );
}

function CanvasAgentConversation(props: CanvasAgentPanelProps & { sessionId: string; tabs: ConversationTabs; onConversationRunningChange: (sessionId: string, running: boolean) => void }) {
  const { locale: uiLocale, label: uiLabel, error: uiError, text } = useUiLocale();
  const [pinned, setPinned] = React.useState<CreativeAgentReference[]>([]);
  const [excluded, setExcluded] = React.useState<string[]>([]);
  // 手动删掉的素材只在它仍被选中时排除（避免删了又被加回来）；取消选中后解除，下次再选中会正常带进输入框
  React.useEffect(() => {
    setExcluded(current => {
      const next = current.filter(key => props.selection.references.some(reference => creativeAgentReferenceKey(reference) === key));
      return next.length === current.length ? current : next;
    });
  }, [props.selection.references]);
  const referenceQueue = React.useRef(Promise.resolve());
  const [preparingReferences, setPreparingReferences] = React.useState(0);
  const isReferenceReady = (reference: CreativeAgentReference) => {
    const task = ["imageTask", "videoTask", "audioTask"].includes(reference.kind);
    if (props.onGetReferencePreview && (task || ["image", "video", "audio"].includes(reference.kind))) return Boolean(props.onGetReferencePreview(reference)?.url);
    return !task || Boolean(reference.outputId || reference.generationId || reference.mediaId);
  };
  const hasMaterialReference = (reference: CreativeAgentReference) => !["imageTask", "videoTask", "audioTask"].includes(reference.kind)
    || Boolean(reference.outputId || reference.generationId || reference.mediaId) || isReferenceReady(reference);
  // The picker can expose only primary outputs; the preview resolver checks an
  // explicitly pinned historical output without silently substituting that primary.
  const missingReferences = (wanted: CreativeAgentReference[], current?: CreativeAgentReference[]) => wanted.filter(reference => !isReferenceReady(reference)
    || !props.onGetReferencePreview && current && !current.some(item => creativeAgentReferenceKey(item) === creativeAgentReferenceKey(reference)));
  const agent = useCreativeAgent({
    ...props,
    onPrepareMessage: async () => {
      const context = await props.onPrepareMessage();
      const current = props.onGetReferences?.() ?? context.selection.references;
      const wanted = mergeCreativeAgentReferences(context.selection.references.filter(hasMaterialReference), pinned)
        .filter(item => !excluded.includes(creativeAgentReferenceKey(item)));
      const missing = missingReferences(wanted, props.onGetReferences ? current : undefined);
      if (missing.length) throw new Error(`${missing.map(item => item.label).join("、")}：引用已失效，请移除或重新选择后发送。`);
      const references = wanted
        .map((reference) => pinned.find(item => creativeAgentReferenceKey(item) === creativeAgentReferenceKey(reference)) ?? current.find(item => creativeAgentReferenceKey(item) === creativeAgentReferenceKey(reference)))
        .filter((item): item is CreativeAgentReference => Boolean(item));
      if (references.length !== wanted.length)
        throw new Error("引用的节点已发生变化，请重新选择素材。");
      const removedNodes = new Set(context.selection.references.filter(item => excluded.includes(creativeAgentReferenceKey(item))).map(item => item.nodeId));
      return {
        ...context,
        selection: { ...context.selection, nodeIds: [...new Set([...context.selection.nodeIds.filter(id => !removedNodes.has(id)), ...references.map(item => item.nodeId)])], references },
      };
    },
  });
  const { view, draft, setDraft } = agent;
  const panel = React.useRef<HTMLElement>(null);
  const composer = React.useRef<HTMLFormElement>(null);
  const preferenceTrigger = React.useRef<HTMLButtonElement>(null);
  const skillPopup = React.useRef<HTMLDivElement>(null);
  const transcript = React.useRef<HTMLDivElement>(null);
  const transcriptContent = React.useRef<HTMLDivElement>(null);
  const promptEditor = React.useRef<Editor | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const composing = React.useRef(false);
  const compositionEndedAt = React.useRef(0);
  const follow = React.useRef(true);
  const [atBottom, setAtBottom] = React.useState(true);
  const [menu, setMenu] = React.useState<Menu>(null);
  const { user } = useAuth();
  const authUserId = user ? String(user.id) : "";
  const [skillLibraryOpen, setSkillLibraryOpen] = React.useState(false);
  const [skillLibraryView, setSkillLibraryView] = React.useState<"browse" | "create" | "edit" | "detail">("browse");
  const [editingSkill, setEditingSkill] = React.useState<RoleSkillListItem | null>(null);
  const [deletingSkill, setDeletingSkill] = React.useState<RoleSkillListItem | null>(null);
  const [skillDeleteError, setSkillDeleteError] = React.useState("");
  const skillTabKey = `${authUserId}:${props.canvasId}`;
  const [skillTab, setSkillTab] = React.useState<RoleSkillPickerSource>(() => skillTabs.get(skillTabKey) ?? "system");
  const { favoriteSkillIds: favoriteSkills, removeFavoriteSkill } = useRoleSkillFavorites(authUserId);
  const [skillPopupPosition, setSkillPopupPosition] = React.useState<React.CSSProperties | null>(null);
  const { skills, loading: skillsLoading, error: skillsError, refresh: refreshSkills } = useRoleSkillCatalog({ authUserId, enabled: props.visible !== false || skillLibraryOpen });
  const { skillId: commandSkillId, text: promptValue } = splitSkillPrompt(draft);
  const draftSkillId = commandSkillId ?? agent.selectedSkillId;
  const selectedSkillIdRef = React.useRef<string | null>(draftSkillId);
  selectedSkillIdRef.current = draftSkillId;
  const knownSkills = React.useRef(new Map<string, RoleSkillListItem>());
  for (const skill of skills) knownSkills.current.set(skill.id, skill);
  const selectedSkill = draftSkillId ? knownSkills.current.get(draftSkillId) ?? null : null;
  const [query, setQuery] = React.useState("");
  const mentionScopeKey = `${authUserId}:${props.canvasId}`;
  const [scope, setScope] = React.useState(() => mentionScopes.get(mentionScopeKey) ?? "canvas");
  const [references, setReferences] = React.useState<CreativeAgentReference[]>(
    [],
  );
  const [activeOption, setActiveOption] = React.useState(0);
  const [skillKeyboardNavigation, setSkillKeyboardNavigation] = React.useState(0);
  const mentionRange = React.useRef<{ start: number; end: number } | null>(
    null,
  );
  const [notice, setNotice] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const editRequest = React.useRef<{ text: string; expectedText: string; requestId: string } | null>(null);
  const [dialog, setDialog] = React.useState<"settings" | null>(null);
  // 偏好面板关闭后焦点会回到“创作偏好”按钮；此时不弹摘要卡，直到鼠标离开或焦点移走
  const [preferenceCardMuted, setPreferenceCardMuted] = React.useState(false);
  const previousDialog = React.useRef(dialog);
  React.useEffect(() => {
    if (previousDialog.current === "settings" && dialog !== "settings") setPreferenceCardMuted(true);
    previousDialog.current = dialog;
  }, [dialog]);
  const [preferenceTab, setPreferenceTab] = React.useState<CreationPreferenceTab>("chat");
  const [modelCatalog, setModelCatalog] = React.useState<{ userId: string; value: CreationModelCatalog } | null>(null);
  const models = modelCatalog?.userId === authUserId ? modelCatalog.value : null;
  const [modelError, setModelError] = React.useState("");
  const [modelLoading, setModelLoading] = React.useState(false);
  const [catalogRetry, setCatalogRetry] = React.useState(0);
  const preferenceKey = creationPreferencesKey(authUserId, props.canvasId, props.sessionId);
  const [preferenceRecord, setPreferenceRecord] = React.useState<{ key: string; value: CreationPreferences } | null>(null);
  const savedPreferences = preferenceRecord?.key === preferenceKey ? preferenceRecord.value : emptyCreationPreferences();
  const defaultChatModel = preferenceRecord?.key === preferenceKey ? models?.chat[0] : undefined;
  const preferences: CreationPreferences = savedPreferences.model || !defaultChatModel ? savedPreferences : {
    ...savedPreferences,
    model: `${defaultChatModel.providerId}::${defaultChatModel.modelId}`,
    thinkingLevel: "default",
  };
  const modelPreview = preferences.model;
  React.useEffect(() => {
    setPreferenceRecord({ key: preferenceKey, value: readCreationPreferences(preferenceKey, props.canvasId, props.sessionId) });
    setDialog(null);
    setPreferenceTab("chat");
  }, [preferenceKey, props.canvasId, props.sessionId]);
  const previousCapabilityModel = React.useRef("");
  React.useEffect(() => {
    const [providerId, modelId] = modelPreview.split("::");
    const previousModel = previousCapabilityModel.current;
    previousCapabilityModel.current = modelPreview;
    if (!modelPreview && !previousModel) return;
    const abort = new AbortController();
    void agent.refreshCapabilities(providerId && modelId ? {providerId, modelId} : undefined, abort.signal).catch(error => { if (!abort.signal.aborted) setNotice(error.message); });
    return () => abort.abort();
  }, [modelPreview, agent.refreshCapabilities]);
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const attachmentUrls = React.useRef(new Set<string>());
  const [preview, setPreview] = React.useState<{ id: string; left: number; bottom: number } | null>(null);
  const assetTokens = React.useRef(new Map<string, string>());
  const previousComposerAssets = React.useRef<PromptReferenceAsset[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);
  const [inputHeight, setInputHeight] = React.useState(100);
  const inputResize = React.useRef<{
    id: number;
    y: number;
    height: number;
  } | null>(null);
  const active = Boolean(view.run && isCreativeAgentRunActive(view.run.status));
  const running = active || agent.sending;
  const { onConversationRunningChange, sessionId } = props;
  React.useEffect(() => {
    onConversationRunningChange(sessionId, running);
  }, [onConversationRunningChange, sessionId, running]);
  React.useEffect(() => () => onConversationRunningChange(sessionId, false), [onConversationRunningChange, sessionId]);
  // 页面在后台时任务完成：标签页标题提示，切回来恢复
  const lastRunStatus = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    const status = view.run?.status;
    const previous = lastRunStatus.current;
    lastRunStatus.current = status;
    if (!status || !previous || !isCreativeAgentRunActive(previous as never) || isCreativeAgentRunActive(status) || !document.hidden) return;
    const original = document.title;
    document.title = status === "completed" ? "创作完成 ✨" : "创作已结束";
    const restore = () => { if (document.hidden) return; document.title = original; document.removeEventListener("visibilitychange", restore); };
    document.addEventListener("visibilitychange", restore);
  }, [view.run?.status]);
  const available = Boolean(
    agent.capabilities?.enabled && agent.capabilities.ready,
  );
  const locked = agent.loading || agent.sending || agent.revising || agent.uncertain;
  const latestUserMessage = view.messages.findLast(message => message.role === "user");
  // 是否可改由服务端判断：执行前的准备阶段，或新版 Agent 失败/停止的最新一轮
  const editableMessageId = latestUserMessage && latestUserMessage.id === view.editableMessageId && (active || ["failed", "stopped"].includes(view.run?.status ?? "")) ? latestUserMessage.id : null;
  const selectedReferences = mergeCreativeAgentReferences(props.selection.references.filter(hasMaterialReference), pinned)
    .filter(item => !excluded.includes(creativeAgentReferenceKey(item)));
  const unavailableReferences = missingReferences(selectedReferences, props.onGetReferences?.());
  const canSend =
    available &&
    agent.online &&
    !locked &&
    !agent.syncing &&
    !active &&
    !preparingReferences &&
    !unavailableReferences.length &&
    attachments.every(item => item.status === "ready") &&
    Boolean(draft.trim());
  // 手动停止的最新一轮：输入框为空时，发送键变成“继续执行”，从停下的地方接着做
  const resumable = !active && view.run?.status === "stopped" && Boolean(editableMessageId) && !draft.trim() && !locked && agent.online;
  const assetToken = (id: string, name: string) => {
    const existing = assetTokens.current.get(id);
    if (existing) return existing;
    const used = new Set(assetTokens.current.values());
    let token = name;
    for (let suffix = 2; used.has(token); suffix++) token = `${name} (${suffix})`;
    assetTokens.current.set(id, token);
    return token;
  };
  const composerAssets: (PromptReferenceAsset & { preview?: ReferencePreview; reference?: CreativeAgentReference; attachment?: Attachment })[] = [
    ...selectedReferences.map(reference => {
      const id = `reference:${creativeAgentReferenceKey(reference)}`;
      const media = props.onGetReferencePreview?.(reference);
      const kind: PromptReferenceAsset["kind"] = media?.kind === "text" ? PROMPT_TEXT_ASSET_KIND : !media?.thumbnailUrl && (media?.kind === "video" || media?.kind === "audio") ? media.kind : "image";
      return { id, token: assetToken(id, reference.label), name: reference.label, kind,
        url: media?.kind === "text" ? undefined : media?.thumbnailUrl || media?.url, preview: media, reference };
    }),
    ...attachments.map(attachment => {
      const kind = attachment.type.startsWith("video/") ? "video" : attachment.type.startsWith("audio/") ? "audio" : attachment.type.startsWith("text/") ? "text" : "image";
      const media: ReferencePreview = { kind, url: attachment.url, thumbnailUrl: attachment.thumbnailUrl };
      return { id: attachment.id, token: assetToken(attachment.id, attachment.name), name: attachment.name, kind: kind === "text" ? PROMPT_TEXT_ASSET_KIND : kind,
        url: media.kind === "text" ? undefined : media.thumbnailUrl || media.url, preview: media, attachment };
    }),
  ];
  const inlineAssetIds = new Set(findPromptAssetMentions(promptValue, composerAssets).map(mention => mention.asset.id));
  React.useEffect(() => {
    if (locked || active || props.visible === false) return;
    const previous = previousComposerAssets.current;
    previousComposerAssets.current = composerAssets;
    const removed = previous.filter(asset => !composerAssets.some(current => current.id === asset.id));
    const added = composerAssets.filter(asset => !previous.some(item => item.id === asset.id) && !inlineAssetIds.has(asset.id));
    // 移除取消选中的素材标签时连同它旁边的一个空格一起去掉，否则每换选一次就多留一个空格、标签越来越往右
    let value = removed.length ? removeMentionTokens(promptValue, removed.map(asset => asset.token)) : promptValue;
    if (!value.trim()) value = "";
    // 素材标签后面不再补空格：标签按素材名精确识别，紧接着输入文字也能正常识别，不会在标签后留一块空白
    if (added.length) value += `${value && !/\s$/.test(value) ? " " : ""}${added.map(asset => `@${asset.token}`).join(" ")}`;
    if (value !== promptValue) setDraft(draftSkillId ? `/skill:${draftSkillId} ${value}` : value);
  }, [locked, active, props.visible, composerAssets, draftSkillId, promptValue, setDraft]);
  const previewAsset = preview ? composerAssets.find(asset => asset.id === preview.id) : undefined;
  React.useEffect(() => {
    if (menu === "mentions") setReferences(props.onGetReferences?.() ?? props.selection.references);
  }, [menu, props.onGetReferences, props.selection.references]);
  const filteredReferences = (
    scope === "selected"
      ? selectedReferences
      : scope === "canvas"
        ? references
        : []
  ).filter((item) =>
    isReferenceReady(item) && `${item.label} ${item.kind}`.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredSkills = skills.filter((item) =>
    (skillTab === "all" || (skillTab === "favorites" ? favoriteSkills.includes(item.id) : item.source === skillTab)) &&
    `${item.id} ${item.name} ${item.summary}`
      .toLowerCase()
      .includes(query.toLowerCase().replace(/^skill:/, "")),
  );
  React.useEffect(() => setActiveOption(0), [favoriteSkills]);
  const scrollToBottom = () => {
    follow.current = true;
    setAtBottom(true);
    transcript.current?.scrollTo({
      top: transcript.current.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };
  React.useEffect(() => {
    if (follow.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [view.messages, view.tools, view.decision, view.media, props.visible]);
  React.useEffect(() => {
    if (!transcriptContent.current) return;
    const observer = new ResizeObserver(() => {
      if (follow.current && transcript.current)
        transcript.current.scrollTop = transcript.current.scrollHeight;
    });
    observer.observe(transcriptContent.current);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (menu === "mentions")
      panel.current
        ?.querySelector(`#agent-${props.sessionId}-option-${activeOption}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [activeOption, menu]);
  React.useLayoutEffect(() => {
    if (menu !== "skills" || props.visible === false) {
      setSkillPopupPosition(null);
      return;
    }
    const anchor = composer.current;
    const surface = panel.current;
    if (!anchor || !surface) return;
    let frame = 0;
    const position = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = surface.getBoundingClientRect();
      const width = Math.min(450, window.innerWidth - 24);
      const bottomEdge = Math.max(Math.min(220, window.innerHeight - 12), Math.min(anchorRect.bottom - 48, window.innerHeight - 12));
      const next = {
        width,
        left: Math.max(12, Math.min(panelRect.left - 38, window.innerWidth - width - 12)),
        bottom: window.innerHeight - bottomEdge,
        maxHeight: Math.min(400, bottomEdge - 12),
      };
      setSkillPopupPosition((current) => current?.width === next.width && current.left === next.left && current.bottom === next.bottom && current.maxHeight === next.maxHeight ? current : next);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    const onPointerMove = (event: PointerEvent) => { if (event.buttons) schedule(); };
    position();
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor);
    observer.observe(surface);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("pointermove", onPointerMove);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [menu, props.visible, props.docked]);
  React.useEffect(() => {
    if (props.visible === false) {
      setMenu(null);
      setDialog(null);
      setPreview(null);
      setDragging(false);
      dragDepth.current = 0;
      return;
    }
    promptEditor.current?.commands.focus(undefined, { scrollIntoView: false });
  }, [props.visible, agent.loading]);
  React.useEffect(() => {
    if (!preview) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-agent-preview], [data-asset-id]")) setPreview(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [preview]);
  React.useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(
          "[data-agent-popup], [data-agent-menu-trigger], [data-agent-editor]",
        )
      )
        setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  const latestUserMessageId = [...view.messages].reverse().find(message => message.role === "user")?.id;
  React.useEffect(() => {
    if (!agent.loading && latestUserMessageId && (!active || view.run?.status === "waiting_decision")) {
      void props.tabs.summarize(props.sessionId, latestUserMessageId);
    }
  }, [agent.loading, latestUserMessageId, active, view.run?.status, props.sessionId, props.tabs.summarize]);
  React.useEffect(() => {
    if (!authUserId) return;
    let request: AbortController | undefined;
    const load = () => {
      request?.abort();
      const abort = new AbortController();
      request = abort;
      setModelCatalog(null);
      setModelLoading(true);
      setModelError("");
      void fetch("/api/creative-agent/catalog", {
        credentials: "same-origin",
        cache: "no-store",
        signal: abort.signal,
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error || "模型列表读取失败");
          if (!abort.signal.aborted) {
            setModelCatalog({ userId: authUserId, value: {
              chat: data.chat ?? [],
              image: data.image ?? [],
              video: data.video ?? [],
            } });
          }
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setModelError(
              error instanceof Error ? error.message : text("workspaceFollowup.m034c2d43367e"),
            );
        })
        .finally(() => {
          if (!abort.signal.aborted) setModelLoading(false);
        });
    };
    load();
    const unsubscribe = subscribeToolboxModelVisibilityChanged(load);
    return () => { request?.abort(); unsubscribe(); };
  }, [authUserId, catalogRetry]);
  React.useEffect(
    () => () => {
      attachmentUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  React.useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  // 上下文与用量弹窗贴着圆环按钮，从按钮正上方弹出（右下角对齐按钮），而不是盖住整个输入框
  const [contextAnchor, setContextAnchor] = React.useState<{ right: number; bottom: number } | null>(null);
  React.useLayoutEffect(() => {
    if (menu !== "context") return;
    const place = () => {
      const form = composer.current, trigger = form?.querySelector<HTMLElement>("[data-context-trigger]");
      if (!form || !trigger) return;
      const box = form.getBoundingClientRect(), anchor = trigger.getBoundingClientRect();
      setContextAnchor({ right: Math.max(0, Math.round(box.right - anchor.right - 4)), bottom: Math.round(box.bottom - anchor.top + 6) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [menu]);
  const openMenu = (next: Menu) => {
    setMenu((current) => (current === next ? null : next));
    setQuery("");
    setActiveOption(0);
    mentionRange.current = null;
    if (next === "skills") setSkillTab(skillTabs.get(skillTabKey) ?? "system");
    if (next === "mentions") {
      setScope(mentionScopes.get(mentionScopeKey) ?? "canvas");
      setReferences(props.onGetReferences?.() ?? props.selection.references);
    }
  };
  const setPromptValue = (value: string) => {
    setDraft(commandSkillId ? `/skill:${commandSkillId} ${value}` : value);
  };
  const getPromptSelection = () => {
    const editor = promptEditor.current;
    if (!editor || editor.isDestroyed) return { start: promptValue.length, end: promptValue.length };
    const { doc, selection } = editor.state;
    return {
      start: editorDocToPromptText(doc.cut(0, selection.from).toJSON() as PromptRichEditorDoc).length,
      end: editorDocToPromptText(doc.cut(0, selection.to).toJSON() as PromptRichEditorDoc).length,
    };
  };
  const updateSuggestions = (value: string) => {
    if (composing.current || promptEditor.current?.view.composing) return;
    const caret = getPromptSelection().start;
    let match: RegExpMatchArray | null = value.slice(0, caret).match(/(?:^|\s)([@/])([^\s@/]*)$/);
    // 紧跟在已有素材标签后面输入 @ 也弹出素材面板，可以连续引用多个素材
    if (!match) {
      const tail = value.slice(0, caret).match(/@([^\s@/]*)$/);
      const at = tail ? caret - tail[0].length : -1;
      if (tail && at > 0 && findPromptAssetMentions(value, composerAssets).some(mention => mention.to === at)) match = Object.assign(["", "@", tail[1]], { index: at }) as RegExpMatchArray;
    }
    if (match?.[1] === "@" && findPromptAssetMentions(value, composerAssets).some(mention => mention.from < caret && mention.to >= caret)) {
      setMenu(null);
      mentionRange.current = null;
      return;
    }
    if (match) {
      mentionRange.current = { start: caret - match[2].length - 1, end: caret };
      setQuery(match[2]);
      setActiveOption(0);
      setMenu(match[1] === "@" ? "mentions" : "skills");
      if (match[1] === "/") setSkillTab(skillTabs.get(skillTabKey) ?? "system");
      else {
        setScope(mentionScopes.get(mentionScopeKey) ?? "canvas");
        setReferences(props.onGetReferences?.() ?? props.selection.references);
      }
    } else if (menu === "mentions" || menu === "skills") {
      setMenu(null);
      mentionRange.current = null;
    }
  };
  const insert = (text: string) => {
    const { start, end } = mentionRange.current ?? getPromptSelection();
    setPromptValue(promptValue.slice(0, start) + text + promptValue.slice(end));
    setMenu(null);
    mentionRange.current = null;
    requestAnimationFrame(() => {
      const editor = promptEditor.current;
      if (!editor || editor.isDestroyed) return;
      // External prompt changes normalize the editor to one paragraph with hard breaks.
      const target = start + text.length;
      let offset = 0;
      let position = 1;
      editor.state.doc.descendants((node, pos) => {
        if (!node.isInline || offset >= target) return;
        const length = node.isText ? node.text!.length : node.type.name === ASSET_MENTION_NODE_NAME ? `@${node.attrs.token}`.length : node.type.name === "hardBreak" ? 1 : 0;
        position = pos + (node.isText ? Math.min(target - offset, length) : node.nodeSize);
        offset += length;
      });
      editor.commands.setTextSelection(Math.min(position, editor.state.doc.content.size - 1));
      editor.commands.focus(undefined, { scrollIntoView: false });
    });
  };
  const insertCurrent = React.useRef(insert);
  insertCurrent.current = insert;
  /** fromResult：从对话里的生成结果引用，按生成任务和第几张找到画布上的那份输出 */
  const selectReference = (reference: CreativeAgentReference, fromResult?: { outputIndex?: number }) => {
    setPreparingReferences(count => count + 1);
    const work = referenceQueue.current.then(async () => {
    try {
      await props.onPrepareMessage();
      if (fromResult) await props.onCanvasCommitted();
      const response = await fetch(`/api/creative-agent/canvases/${props.canvasId}/project?sessionId=${props.sessionId}&nodeIds=${encodeURIComponent(JSON.stringify([reference.nodeId]))}`, {cache:"no-store"});
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "读取引用版本失败");
      const candidates = (data.candidates as CreativeAgentReference[]).filter(item => item.nodeId === reference.nodeId);
      const outputs = candidates.filter(item => ["image", "video"].includes(item.kind));
      const sameTask = outputs.filter(item => item.generationId === reference.generationId);
      const fixed = fromResult
        ? (sameTask.length ? sameTask : outputs)[fromResult.outputIndex ?? 0] ?? (sameTask.length ? sameTask : outputs)[0]
        : candidates.find(item => creativeAgentReferenceKey(item) === creativeAgentReferenceKey(reference));
      if (!fixed || !isReferenceReady(fixed)) throw new Error("引用输出已变化或已移除，请刷新画布后重新选择");
      const key = creativeAgentReferenceKey(fixed);
      setPinned(current => [...current.filter(item => creativeAgentReferenceKey(item) !== key), fixed]);
      setExcluded(current => current.filter(id => id !== key));
      insertCurrent.current(inlineAssetIds.has(`reference:${key}`) ? "" : `@${assetToken(`reference:${key}`, fixed.label)}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : text("workspaceFollowup.mfe91697eee45")); }
    finally { setPreparingReferences(count => count - 1); }
    });
    referenceQueue.current = work;
    return work;
  };
  const selectSkill = (skill: (typeof skills)[number]) => {
    const range = mentionRange.current;
    const remaining = range ? promptValue.slice(0, range.start) + promptValue.slice(range.end) : promptValue;
    knownSkills.current.set(skill.id, skill);
    selectedSkillIdRef.current = skill.id;
    agent.setSelectedSkillId(skill.id);
    setDraft(remaining);
    setSkillLibraryOpen(false);
    setMenu(null);
    mentionRange.current = null;
    requestAnimationFrame(() => {
      promptEditor.current?.commands.focus("end", { scrollIntoView: false });
    });
  };
  // 点“下一步”按钮：输入框是空的就直接发送；已经写了内容就追加到输入框里，不覆盖也不自动发
  const quickReply = React.useRef<string | null>(null);
  const sendQuickReply = (text: string) => {
    if (promptValue.trim()) {
      setPromptValue(`${promptValue.trimEnd()} ${text}`);
      requestAnimationFrame(() => promptEditor.current?.commands.focus("end", { scrollIntoView: false }));
      return;
    }
    quickReply.current = text;
    setPromptValue(text);
  };
  React.useEffect(() => {
    if (quickReply.current && promptValue.trim() === quickReply.current) {
      quickReply.current = null;
      submit();
    }
  });
  const submit = () => {
    if (!canSend) return;
    const [providerId, modelId] = modelPreview.split("::");
    if (!providerId || !modelId) {
      setNotice(text("workspaceFollowup.md558dd25728c"));
      setPreferenceTab("chat");
      setDialog("settings");
      return;
    }
    if (modelLoading || !models || modelError) {
      setNotice(modelError || text("workspaceFollowup.md7a780a23a7a"));
      setDialog("settings");
      return;
    }
    const conflicts = creationPreferencesConflict({ ...preferences, media: {} }, models);
    if (conflicts.length) {
      setNotice(conflicts[0]);
      setPreferenceTab("chat");
      setDialog("settings");
      return;
    }
    saveCreationPreferences(preferenceKey, preferences);
    follow.current = true;
    setEditing(null);
    setMenu(null);
    void agent.send({
      model: { providerId, modelId },
      thinkingLevel: preferences.thinkingLevel,
      attachments: attachments.flatMap(item => item.serverId ? [{ id: item.serverId }] : []),
      preferences: structuredClone(preferences.media),
      ...(excluded.length ? { referenceMode: (composerAssets.some(asset => asset.id.startsWith("reference:")) || attachments.length ? "replace" : "clear") as "replace" | "clear" } : {}),
    }).then(accepted => { if (accepted) { attachments.forEach(item => URL.revokeObjectURL(item.url)); setAttachments([]); setPinned([]); setExcluded([]); } });
  };
  const uploadControllers = React.useRef(new Map<string, AbortController>());
  React.useEffect(() => () => uploadControllers.current.forEach(controller => controller.abort()), []);
  const selectLibraryMaterial = (material: PersonalMaterial) => {
    if (locked) return;
    const id = `material:${material.id}`;
    if (attachments.some((item) => item.id === id) || uploadControllers.current.has(id)) return;
    if (attachments.length >= 6) {
      setNotice(text("workspaceFollowup.mb521e9b0202c"));
      return;
    }
    const controller = new AbortController();
    uploadControllers.current.set(id, controller);
    setAttachments((current) => [...current, {
      id, materialId: material.id, name: material.name, type: material.mime, size: material.size,
      url: personalMaterialUrl(material.id),
      thumbnailUrl: material.kind === "image" ? personalMaterialPreviewUrl(material.id, Number(authUserId)) : undefined,
      status: "uploading",
    }]);
    insert(`@${assetToken(id, material.name)}`);
    void fetch(`/api/creative-agent/canvases/${props.canvasId}/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal: controller.signal,
      body: JSON.stringify({ sessionId: props.sessionId, materialId: material.id }),
    })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "素材引用失败"); return data.attachment; })
      .then((item) => { if (!controller.signal.aborted) setAttachments((current) => current.map((entry) => entry.id === id ? { ...entry, serverId: item.id, status: "ready", coverage: item.coverage } : entry)); })
      .catch((error) => { if (!controller.signal.aborted) setAttachments((current) => current.map((entry) => entry.id === id ? { ...entry, status: "error", error: error instanceof Error ? error.message : "素材引用失败" } : entry)); })
      .finally(() => { if (uploadControllers.current.get(id) === controller) uploadControllers.current.delete(id); });
  };
  const addFiles = (files: FileList | File[]) => {
    if (locked) return;
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      const isDocument = isAgentTextDocument(file);
      // 视频放宽到 100 MB：保存下来的爆款短视频常超过 30 MB；文档（剧本、文案）限 300 KB，约 10 万字
      if (attachments.length + next.length >= 6 || file.size > (isDocument ? 300_000 : file.type.startsWith("video/") ? 100_000_000 : 32_000_000)) {
        setNotice(text("workspaceFollowup.md2a8f5f7d7ad"));
        continue;
      }
      const url = URL.createObjectURL(file);
      attachmentUrls.current.add(url);
      const id = crypto.randomUUID();
      // Browsers often give .md no type; label it so the chip and preview treat it as a document.
      next.push({ id, name: file.name, type: isDocument && !file.type.startsWith("text/") ? "text/markdown" : file.type, size: file.size, url, status: "uploading" });
      const controller = new AbortController(); uploadControllers.current.set(id, controller);
      const form = new FormData(); form.append("file", file); form.append("sessionId", props.sessionId);
      void fetch(`/api/creative-agent/canvases/${props.canvasId}/attachments`, { method: "POST", body: form, credentials: "same-origin", signal: controller.signal })
        .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "附件上传失败"); return data.attachment; })
        .then(item => { setAttachments(current => current.map(entry => entry.id === id ? { ...entry, serverId: item.id, status: "ready", coverage: item.coverage } : entry)); })
        .catch(error => { if (!controller.signal.aborted) setAttachments(current => current.map(entry => entry.id === id ? { ...entry, status: "error", error: error instanceof Error ? error.message : "上传失败" } : entry)); })
        .finally(() => uploadControllers.current.delete(id));
    }
    setAttachments(current => [...current, ...next]);
    if (next.length) insert(next.map(item => `@${assetToken(item.id, item.name)}`).join(" "));
  };
  const removeAttachment = (item: Attachment) => {
    uploadControllers.current.get(item.id)?.abort();
    URL.revokeObjectURL(item.url);
    attachmentUrls.current.delete(item.url);
    setAttachments((current) =>
      current.filter((entry) => entry.id !== item.id),
    );
    if (preview?.id === item.id) setPreview(null);
  };
  const removeComposerAsset = (asset: typeof composerAssets[number], removeText = true) => {
    if (asset.reference) {
      setPinned(current => current.filter(item => creativeAgentReferenceKey(item) !== creativeAgentReferenceKey(asset.reference!)));
      setExcluded(current => [...current, creativeAgentReferenceKey(asset.reference!)]);
    }
    if (asset.attachment) removeAttachment(asset.attachment);
    if (removeText) setPromptValue(removeMentionTokens(promptValue, [asset.token]));
    if (preview?.id === asset.id) setPreview(null);
  };
  const openAssetPreview = (id: string, target: HTMLElement) => {
    const bounds = composer.current?.getBoundingClientRect();
    if (!bounds) return;
    const rect = target.getBoundingClientRect();
    setMenu(null);
    setPreview(current => current?.id === id ? null : { id, left: Math.max(8, Math.min(rect.left - bounds.left, bounds.width - 188)), bottom: bounds.bottom - rect.top + 8 });
  };
  const copy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setNotice(text("workspaceFollowup.m8f6f8d979c98"));
    } catch {
      setNotice(text("workspaceFollowup.maa373dd32a89"));
    }
  };
  const cancelEdit = () => {
    setEditing(null);
    editRequest.current = null;
  };
  const sendEdit = async (message: typeof view.messages[number]) => {
    if (locked || !agent.online || editableMessageId !== message.id || !message.runId || !editText.trim()) return;
    const { skillId } = splitSkillPrompt(message.text);
    const text = `${skillId ? `/skill:${skillId} ` : ""}${editText.trim()}`;
    if (editRequest.current?.text !== text) editRequest.current = { text, expectedText: message.text, requestId: crypto.randomUUID() };
    const accepted = await agent.revise({ runId: message.runId, messageId: message.id, ...editRequest.current });
    if (accepted) { setEditing(null); editRequest.current = null; }
  };
  const editorKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (
      composing.current ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      Date.now() - compositionEndedAt.current < 80
    )
      return;
    const options =
      menu === "mentions"
        ? filteredReferences
        : menu === "skills"
          ? filteredSkills
          : [];
    if (
      (menu === "mentions" || menu === "skills") &&
      ["ArrowUp", "ArrowDown", "Enter", "Tab"].includes(event.key) &&
      !event.shiftKey
    ) {
      if (!options.length && event.key === "Tab") {
        setMenu(null);
        return;
      }
      event.preventDefault();
      if (!options.length) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (menu === "skills") setSkillKeyboardNavigation((value) => value + 1);
        setActiveOption(
          (value) =>
            (value + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length,
        );
      } else if (menu === "mentions")
        selectReference(filteredReferences[activeOption % options.length]);
      else selectSkill(filteredSkills[activeOption % options.length]);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };
  const [undoBusy, setUndoBusy] = React.useState<string | null>(null);
  const [undone, setUndone] = React.useState<string[]>([]);
  const undoAction = async (actionId: string) => {
    if (undoBusy || active) return;
    setUndoBusy(actionId);
    try {
      await props.onPrepareMessage();
      const response = await fetch(`/api/creative-agent/actions/${encodeURIComponent(actionId)}/undo`, {method:"POST"});
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "撤销失败");
      await props.onCanvasCommitted(); setUndone(current => [...current, actionId]); setNotice(text("workspaceFollowup.m1a6be583229d"));
    } catch (error) { setNotice(error instanceof Error ? error.message : text("workspaceFollowup.mbcec4f183401")); }
    finally { setUndoBusy(null); }
  };
  const displayMessages = view.messages.filter(message => (message.role === "user" || message.text.trim() || message.thinking?.content) && !(message.id === `${message.runId}:media:completed` && view.media?.some(media => media.runId === message.runId)));
  const activity = describeAgentActivity(view);
  const pendingQuestion = view.decision && isQuestion(view.decision) ? view.decision : null;
  const renderTurnFooter = (runId: string) => {
    if (agent.loading || runId === view.run?.id && (active || agent.syncing || view.mediaPending)) return null;
    const media = view.media.filter(item => item.runId === runId);
    if (media.some(item => !["success", "failed", "cancelled", "canceled"].includes(item.status))) return null;
    if (!media.length && !view.messages.some(message => message.runId === runId && message.role === "assistant" && message.text.trim())) return null;
    const finishedAt = getTurnFinishedAt(view, runId);
    return <UiProps ids={{"aria-label":["common.ma522a88a2ae8"]}}><div className={`${styles.messageActions} ${styles.turnFooter}`} role="group" aria-label="common.ma522a88a2ae8">
      <UiProps ids={{"label":["common.me7d02d5a35af"]}}><IconButton label="common.me7d02d5a35af" onClick={() => void copy(buildTurnCopyText(view, runId, window.location.origin))}><Copy size={16} strokeWidth={1.5} /></IconButton></UiProps>
      {finishedAt && <time dateTime={finishedAt} title={text("workspaceFollowup.mf1de3168e1e8", { v0: new Date(finishedAt).toLocaleString(uiLocale === "en" ? "en-US" : undefined) })}>{new Date(finishedAt).toLocaleTimeString(uiLocale === "en" ? "en-US" : undefined, { hour: "2-digit", minute: "2-digit", ...(uiLocale === "zh-CN" ? { hourCycle: "h23" as const } : {}) })}</time>}
    </div></UiProps>;
  };
  const renderUserText = (message: import("@/lib/creative-agent/contracts").CreativeAgentMessage) => {
    const parsed = splitSkillPrompt(message.text);
    const skillId = message.selectedSkillId ?? parsed.skillId, content = parsed.text;
    const skill = skillId ? knownSkills.current.get(skillId) : null;
    return (
      <div className={styles.userText}>
        {skillId && <RoleSkillTag name={skill?.name || "已选技能"} />}
        {sentReferenceSegments(content, message.references ?? []).map((part, index) => part.reference ? (
          <button type="button" key={index} className={`${roleSkillTagClassName} ${styles.sentReference}`} title={part.reference.label} aria-label={text("workspaceFollowup.m2fc20be751bf", { v0: part.reference.label })} onClick={() => props.onLocateNode?.(part.reference!.nodeId)}>
            <span className={styles.sentReferenceThumbnail}><AgentReferenceThumbnail compact preview={props.onGetReferencePreview?.(part.reference)} name={part.reference.label} /></span>
            <span className={styles.sentReferenceName}>{part.reference.label}</span>
          </button>
        ) : <React.Fragment key={index}>{part.text}</React.Fragment>)}
      </div>
    );
  };
  // 按轮次组织：用户消息 → 处理过程（运行中实时展开，结束后折叠）→ 生成结果 → 收尾
  type Turn = { key: string; runId?: string; users: typeof displayMessages; assistants: typeof displayMessages; tools: AgentTool[] };
  const turns: Turn[] = [];
  for (const message of displayMessages) {
    if (message.role === "user") { turns.push({ key: message.id, runId: message.runId, users: [message], assistants: [], tools: [] }); continue; }
    const turn = message.runId ? turns.findLast(item => item.runId === message.runId) : turns.at(-1);
    if (turn) turn.assistants.push(message);
    else turns.push({ key: message.id, runId: message.runId, users: [], assistants: [message], tools: [] });
  }
  for (const tool of view.tools) {
    if (internalToolNames.has(tool.name || "") && !tool.decision) continue;
    const runId = tool.runId || view.run?.id;
    const turn = turns.findLast(item => item.runId === runId);
    // 旧数据或对话记录缺失时，没有对应消息的步骤单独成一轮，不能丢掉
    if (turn) turn.tools.push(tool);
    else turns.push({ key: tool.id, runId, users: [], assistants: [], tools: [tool] });
  }
  // 悬停“创作偏好”时显示当前生效的偏好：手动选的模型/参数显示真实值，未选的显示智能及实际默认值
  const preferenceSummaryId = `creative-agent-preferences-${props.canvasId}-${props.sessionId || "new"}`;
  // 卡片在输入框内、从“创作偏好”按钮正上方弹出；右侧放不下时向左让位，始终不超出输入框
  const [preferenceCardPlace, setPreferenceCardPlace] = React.useState<{ left: number; bottom: number } | null>(null);
  const placePreferenceCard = () => {
    const form = composer.current, button = preferenceTrigger.current, card = document.getElementById(preferenceSummaryId);
    if (!form || !button || !card) return;
    const box = form.getBoundingClientRect(), anchor = button.getBoundingClientRect();
    setPreferenceCardPlace({ left: Math.max(8, Math.min(anchor.left - box.left, box.width - card.offsetWidth - 8)), bottom: Math.round(box.bottom - anchor.top + 6) });
  };
  const preferenceSummary: [string, string][] = (() => {
    const fixed = (value?: string) => value && !["", "auto", "smart", "adaptive"].includes(value) ? value : undefined;
    const image = preferences.media.image, video = preferences.media.video;
    const imageModel = image?.mode === "explicit" && image.model ? models?.image.find(model => model.id === image.model) : undefined;
    const videoModel = video?.mode === "explicit" && video.model ? models?.video.find(model => model.id === video.model) : undefined;
    const imageResolutions = imageModel?.params.resolutions.filter(option => !option.disabled).map(option => option.value);
    const imageResolutionValue = fixed(image?.params?.resolution) ?? (!imageResolutions || imageResolutions.includes("2K") ? "2K" : imageModel?.params.defaultResolution);
    const imageResolution = imageResolutionValue === "auto" ? "自适应分辨率" : imageModel?.params.resolutions.find(option => option.value === imageResolutionValue)?.label ?? imageResolutionValue;
    const imageQuality = fixed(image?.params?.quality) ? imageModel?.params.qualities.find(option => option.value === image?.params?.quality)?.label ?? image?.params?.quality : undefined;
    const videoResolution = fixed(video?.params?.resolution) ?? (videoModel ? (videoModel.params.supportedResolutions.includes("720p" as never) ? "720p" : videoModel.params.supportedResolutions[0]) : "720p");
    const chat = models?.chat.find(model => `${model.providerId}::${model.modelId}` === preferences.model);
    return [
      ["图片偏好", [imageModel?.label ?? (image?.mode === "explicit" && image.model ? image.model : "智能匹配模型"), fixed(image?.params?.aspectRatio) ?? "智能比例", imageResolution, imageQuality && `质量${imageQuality}`].filter(Boolean).join(" · ")],
      ["视频偏好", [videoModel?.label ?? (video?.mode === "explicit" && video.model ? video.model : "智能匹配模型"), fixed(video?.params?.ratio) ?? "自动比例", videoResolution?.toUpperCase(), video?.params?.duration ? `${video.params.duration} 秒` : "智能时长", video?.params?.generateAudio ? "有声" : ""].filter(Boolean).join(" · ")],
      ["推理模型", [chat ? chat.label?.replace(/^.+? · /, "") || chat.modelId : preferences.model.split("::")[1] || "未选择", preferences.thinkingLevel !== "default" ? `思考${LLM_THINKING_LABELS[preferences.thinkingLevel]}` : ""].filter(Boolean).join(" · ")],
    ];
  })();
  // 当前对话模型（实际调用的优先，其次是偏好里选的）及其上下文窗口，用于输入框里的占用圆环
  const chatModel = models?.chat.find(model => model.modelId === (view.actualModel ?? view.usage?.model)) ?? models?.chat.find(model => `${model.providerId}::${model.modelId}` === preferences.model);
  const contextPercent = contextUsage(view.usage, view.usageScopes, chatModel?.contextWindow).percent;
  const modelLabel = (id: string) => modelCatalog?.value.image.find(model => model.id === id)?.label ?? modelCatalog?.value.video.find(model => model.id === id)?.label ?? id;
  const timeOf = (value?: string) => { const time = Date.parse(value || ""); return Number.isFinite(time) ? time : 0; };
  const renderUserArticle = (message: (typeof displayMessages)[number]) => (
    <UiProps key={message.id} ids={{"aria-label":["common.m97f031708891"]}}><article  className={`${styles.message} ${styles.userMessage}`} aria-label="common.m97f031708891" data-turn-anchor={message.id}>
      {editing === message.id ? <UiProps ids={{"aria-label":["common.mdc427e123135"]}}><form className={styles.inlineEdit} aria-label="common.mdc427e123135" onSubmit={event => { event.preventDefault(); void sendEdit(message); }}>
        {splitSkillPrompt(message.text).skillId && <RoleSkillTag name={knownSkills.current.get(splitSkillPrompt(message.text).skillId!)?.name || "已选技能"} />}
        <UiProps ids={{"aria-label":["common.m2b61d5dfd5be"]}}><textarea aria-label="common.m2b61d5dfd5be" autoFocus value={editText} maxLength={20000} rows={3}
          disabled={agent.revising} onChange={event => setEditText(event.target.value)}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === "Escape" && !agent.revising) { event.preventDefault(); cancelEdit(); }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void sendEdit(message); }
          }} /></UiProps>
        {editableMessageId !== message.id && <p role="status"><UiText id="common.mc3ba6c3f902c" /></p>}
        <div className={styles.inlineEditActions}>
          <UiProps ids={{"aria-label":["common.mfada4dfc38e3"]}}><button type="button" aria-label="common.mfada4dfc38e3" disabled={agent.revising} onClick={cancelEdit}><UiText id="common.m2cd0f3be8738" /></button></UiProps>
          <UiProps ids={{"aria-label":["common.m643842d50428"]}}><button type="submit" aria-label="common.m643842d50428" disabled={locked || !agent.online || editableMessageId !== message.id || !editText.trim()}>{agent.revising ? <UiText id="common.m364970d8168c" /> : <UiText id="common.medecf0ae6e51" />}</button></UiProps>
        </div>
      </form></UiProps> : renderUserText(message)}
      {!!message.text.trim() && editing !== message.id && (
        <div className={styles.messageActions}>
          <UiProps ids={{"label":["common.m5d7fd21f1e3c"]}}><IconButton label="common.m5d7fd21f1e3c" onClick={() => void copy(message.text)}><Copy size={16} strokeWidth={1.5} /></IconButton></UiProps>
          {message.id === editableMessageId && (
            <UiProps ids={{"label":["common.m2f6a58d28345"]}}><IconButton label="common.m2f6a58d28345" disabled={locked || !agent.online} onClick={() => {
              follow.current = false;
              setEditing(message.id);
              setEditText(splitSkillPrompt(message.text).text);
              editRequest.current = null;
            }}><Pencil size={16} strokeWidth={1.5} /></IconButton></UiProps>
          )}
        </div>
      )}
    </article></UiProps>
  );
  const renderTurn = (turn: Turn) => {
    const runId = turn.runId;
    const live = Boolean(runId && view.run?.id === runId && active);
    const media = runId ? (view.media || []).filter(item => item.runId === runId) : [];
    const tools = [...turn.tools].sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt) || (a.startedSequence ?? 0) - (b.startedSequence ?? 0));
    const lastText = [...turn.assistants].reverse().find(message => message.text.trim());
    const lastToolAt = tools.reduce((latest, tool) => Math.max(latest, timeOf(tool.createdAt)), 0);
    // 收尾：最后一步之后的那段话放到结果下面；运行中边写边显示也在同一位置，结束前后不跳动。
    // 旧记录可能只有结果没有步骤：只有一段话时分不清是开场还是收尾，留在结果上方
    const final = lastText && timeOf(lastText.createdAt) >= lastToolAt && (tools.length || !media.length || turn.assistants.filter(message => message.text.trim()).length > 1) ? lastText : undefined;
    // 说明文字与步骤按时间穿插；结束后只折叠步骤，说明文字原地保留，前后看到的内容与顺序一致
    type Item = { key: string; at: number; order: number; message?: (typeof turn.assistants)[number]; tool?: AgentTool };
    const timeline: Item[] = [
      ...turn.assistants.filter(message => message.text.trim() || message.thinking?.content).map(message => ({ key: message.id, at: timeOf(message.createdAt), order: 0, message })),
      ...tools.map(tool => ({ key: tool.id, at: timeOf(tool.createdAt), order: 1, tool })),
    ].sort((a, b) => a.at - b.at || a.order - b.order);
    // 相邻（中间没有步骤）的纯思考片段合并成一段，挂到后面那条消息上；沿用第一段的 key，流式输出时展开状态不丢
    const merged: Item[] = [];
    for (const item of timeline) {
      const previousItem = merged.at(-1);
      const previous = previousItem?.message;
      if (item.message && previous && !previous.text.trim() && previous.thinking?.content && item.message.runId === previous.runId) {
        const thinking = item.message.thinking;
        merged[merged.length - 1] = { ...item, key: previousItem!.key, message: { ...item.message, thinking: thinking?.content ? { ...thinking, content: `${previous.thinking.content}\n\n${thinking.content}`, duration: typeof previous.thinking.duration === "number" && typeof thinking.duration === "number" ? previous.thinking.duration + thinking.duration : undefined } : { ...previous.thinking, streaming: false } } };
      } else merged.push(item);
    }
    const finalItem = final ? merged.find(item => item.message?.id === final.id) : undefined;
    const finalMessage = finalItem?.message ?? final;
    const items = merged.filter(item => item !== finalItem);
    const isStep = (item: Item) => Boolean(item.tool || !item.message!.text.trim());
    // 从这一轮实际开始处理算起：重新执行或修改后重跑的轮次，不把中间等待的时间算进去
    const activityTimes = [...turn.assistants.map(message => timeOf(message.createdAt)), ...tools.map(tool => timeOf(tool.createdAt))].filter(Boolean);
    const started = activityTimes.length ? Math.max(timeOf(turn.users[0]?.createdAt), Math.min(...activityTimes) - 1000) : timeOf(turn.users[0]?.createdAt);
    const ended = Math.max(timeOf((final ?? turn.assistants.at(-1))?.createdAt), runId ? timeOf(view.finishedAtByRun?.[runId]) : 0, lastToolAt);
    return <React.Fragment key={turn.key}>
      {turn.users.map(renderUserArticle)}
      <ProcessBlock active={live} collapsible={items.some(isStep)} elapsed={started && ended > started ? formatElapsed(ended - started) : ""} empty={!items.length}>
        {items.map(item => {
          if (item.message) {
            const article = <UiProps ids={{"aria-label":["common.m148743ace1f7"]}}><article className={styles.message} aria-label="common.m148743ace1f7">
              <Markdown text={item.message.text} thinking={item.message.thinking} streaming={live && view.run?.status === "running" && !view.completedIds.includes(item.message.id)} />
            </article></UiProps>;
            return isStep(item) ? <ProcessItem key={item.key}>{article}</ProcessItem> : <React.Fragment key={item.key}>{article}</React.Fragment>;
          }
          const tool = item.tool!;
          return <ProcessItem key={item.key}>{tool.name === "user.ask" && tool.decision ? <AnsweredQuestion tool={tool} />
            : <AgentStep tool={tool} running={live} onLocate={props.onLocateNode}
              extra={tool.canUndo && <button type="button" className={styles.locate} disabled={active || Boolean(undoBusy) || undone.includes(tool.id)} onClick={() => void undoAction(tool.id)}>{undone.includes(tool.id) ? <UiText id="common.mfef96e34f77b" /> : undoBusy === tool.id ? <UiText id="common.md32f69ae73d3" /> : <UiText id="common.me7a9e686a0ea" />}</button>} />}</ProcessItem>;
        })}
      </ProcessBlock>
      <ResultGallery media={media} modelLabel={modelLabel} onLocate={props.onLocateNode} />
      {finalMessage && <UiProps ids={{"aria-label":["common.m148743ace1f7"]}}><article className={`${styles.message} ${styles.finalMessage}`} aria-label="common.m148743ace1f7">
        <Markdown text={finalMessage.text} thinking={finalMessage.thinking} streaming={live && view.run?.status === "running" && !view.completedIds.includes(finalMessage.id)} />
        {!!finalMessage.references?.length && <ReferenceChips references={finalMessage.references} onLocateNode={props.onLocateNode} />}
      </article></UiProps>}
      {finalMessage && !live && turn === turns.at(-1) && !pendingQuestion && (() => {
        const steps = splitNextSteps(finalMessage.text).steps;
        return steps.length ? <UiProps ids={{"aria-label":["common.m7bebf084a656"]}}><div className={styles.nextSteps} role="group" aria-label="common.m7bebf084a656">
          {steps.map(step => <button key={step} type="button" disabled={locked || active || !agent.online} onClick={() => sendQuickReply(step)}>{step}</button>)}
        </div></UiProps> : null;
      })()}
      {runId && renderTurnFooter(runId)}
    </React.Fragment>;
  };

  return (
    <>
    <UiProps ids={{"aria-label":["common.meece942862ef"]}}><aside
      ref={panel}
      data-agent-surface
      id={`agent-conversation-${props.sessionId}`}
      className={styles.panel}
      style={{ display: props.visible === false ? "none" : undefined }}
      aria-label="common.meece942862ef"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Tab" && dialog) {
          const elements = Array.from(
            panel.current?.querySelectorAll<HTMLElement>(
              '[aria-modal="true"] button:not(:disabled), [aria-modal="true"] input, [aria-modal="true"] video, [aria-modal="true"] audio',
            ) ?? [],
          );
          const first = elements[0];
          const last = elements[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
        if (
          event.key !== "Escape" ||
          composing.current ||
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229
        )
          return;
        event.preventDefault();
        if (preview) setPreview(null);
        else if (dialog) setDialog(null);
        else if (menu) setMenu(null);
        else props.onClose();
      }}
    >
      <header className={styles.header} data-agent-drag>
        <AgentConversationTitle tabs={props.tabs} sessionId={props.sessionId} />
        <div className={styles.headerActions}>
          <UiProps ids={{"label":["common.m6897a8ef070b"]}}><IconButton label="common.m6897a8ef070b" disabled={props.tabs.creating || agent.loading} onClick={() => {
            setMenu(null);
            if (!view.messages.length && !view.run && !agent.sending && !agent.uncertain) return;
            void props.tabs.create();
          }}>
            <Plus size={16} />
          </IconButton></UiProps>
          <UiProps ids={{"label":["common.m60636ba247a0"]}}><IconButton
            label="common.m60636ba247a0"
            data-agent-menu-trigger
            aria-expanded={menu === "history"}
            onClick={() => { openMenu("history"); void props.tabs.refresh(); }}
          >
            <History size={16} />
          </IconButton></UiProps>
          {props.onToggleDock && (
            <UiProps ids={{"label":["common.m01612dacc253","common.m97835c3536bb"]}}><IconButton
              label={props.docked ? "common.m01612dacc253" : "common.m97835c3536bb"}
              onClick={props.onToggleDock}
            >
              {props.docked ? (
                <PanelsTopLeft size={17} />
              ) : (
                <PanelRight size={17} />
              )}
            </IconButton></UiProps>
          )}
          <UiProps ids={{"label":["common.m24ea12474c81"]}}><IconButton label="common.m24ea12474c81" onClick={props.onClose}>
            <X size={16} />
          </IconButton></UiProps>
        </div>
        {menu === "history" && (
          <UiProps ids={{"aria-label":["common.m60636ba247a0"]}}><div
            className={`${styles.popup} ${styles.historyPopup}`}
            data-agent-popup
            role="dialog"
            aria-label="common.m60636ba247a0"
          >
            <div className={styles.popupHeading}><UiText id="common.m60636ba247a0" /></div>
            {!props.tabs.sessions.some(session => session.messageCount > 0) && <p className={styles.menuHint}><UiText id="common.m070cdd696c43" /></p>}
            {props.tabs.sessions.filter(session => session.messageCount > 0).map(session => (
              <button
                type="button"
                className={styles.menuItem}
                key={session.id}
                aria-current={session.id === props.sessionId ? "true" : undefined}
                onClick={() => { props.tabs.open(session.id); setMenu(null); }}
              >
                <span>
                  <strong>{session.title}</strong>
                </span>
              </button>
            ))}
          </div></UiProps>
        )}
      </header>
      {props.tabs.error && <div className={styles.notice} role="alert">{uiError(props.tabs.error)}</div>}
      {agent.capabilities && !available && (
        <div className={styles.notice}>
          {agent.capabilities.reason || <UiText id="common.m1e483cb51918" />}
        </div>
      )}
      {!agent.online && (
        <div className={styles.notice}>
          <WifiOff size={14} /><UiText id="common.m095c01c34976" /></div>
      )}
      <div className={styles.messageViewport}>
        <UiProps ids={{"aria-label":["common.md947533bdc23"]}}><div
          className={styles.transcript}
          ref={transcript}
          role="log"
          aria-label="common.md947533bdc23"
          aria-live="polite"
          onClickCapture={event => { if (event.target instanceof Element && event.target.closest("summary, [data-agent-expand]")) { follow.current = false; setAtBottom(false); } }}
          onScroll={() => {
            const node = transcript.current;
            if (node) {
              follow.current =
                node.scrollHeight - node.scrollTop - node.clientHeight < 56;
              setAtBottom(follow.current);
            }
          }}
        >
          <div ref={transcriptContent} className={!view.messages.length ? styles.emptyTranscript : undefined}>
            {agent.loading && (
              <div className={styles.loading} role="status"><UiText id="common.m58fd0a712aa8" /></div>
            )}
            {!view.messages.length && !agent.loading && !pendingQuestion && (
              <UiProps ids={{"aria-label":["common.m81e3bb8bcad4"]}}><section className={styles.emptyWelcome} aria-label="common.m81e3bb8bcad4">
                <h3><UiText id="common.m670d9743542c" /></h3>
                <p><UiText id="common.m7d61328c3237" /></p>
              </section></UiProps>
            )}
            {turns.map(renderTurn)}
            {[...new Set((view.media || []).filter(media => !turns.some(turn => turn.runId === media.runId)).map(media => media.runId))].map(runId => <React.Fragment key={runId}><ResultGallery media={view.media.filter(media => media.runId === runId)} modelLabel={modelLabel} onLocate={props.onLocateNode} />{renderTurnFooter(runId)}</React.Fragment>)}
            {/* 进行中的状态放在对话流末尾、回复将出现的位置（与常见 AI 对话产品一致），而不是钉在输入框上方 */}
            {/* 只在真正进行中显示；一轮结束后同步状态时不再显示“本轮已完成”这类结束语 */}
            {!pendingQuestion && (active || agent.sending || agent.syncing && !(view.run && ["completed", "failed", "stopped", "cancelled"].includes(view.run.status))) && (
              <UiProps ids={{"aria-label":["common.mb53c937cd1a1"]}}><div className={styles.runControls} role="status" aria-label="common.mb53c937cd1a1" aria-atomic="true">
                <span className={styles.runLabel}>
                  <AgentMark state="thinking" size={18} />
                  {agent.sending
                    ? <UiText id="common.m4117508751d8" />
                    : view.run
                      ? uiLabel(activity?.label || statusLabel[view.run.status])
                      : <UiText id="common.m954ec984cd4f" />}
                </span>
                {!agent.sending && activity?.detail && <span className={styles.activityDetail}>{uiLabel(activity.detail)}</span>}
              </div></UiProps>
            )}
            {pendingQuestion && <div className={styles.questionStatus} role="status"><MessageSquare size={14} strokeWidth={1.5} /><UiText id="common.m5468b0f9d691" /></div>}
            {view.decision && !pendingQuestion && (
              <DecisionCard
                key={`${view.decision.id}:${view.decision.proposalHash}`}
                decision={view.decision}
                busy={agent.decisionBusy}
                online={agent.online}
                onAnswer={agent.answer}
              />
            )}
          </div>
        </div></UiProps>
        <TurnRail container={transcript} items={turns.flatMap(turn => turn.users.map(message => ({ id: message.id, text: splitSkillPrompt(message.text).text.replace(/\s+/g, " ").trim() || text("workspaceFollowup.m574c2136d97c") })))} />
        {!atBottom && (
          <UiProps ids={{"aria-label":["common.m690710fc2d0b"],"title":["common.m690710fc2d0b"]}}><button
            type="button"
            className={styles.scrollBottom}
            aria-label="common.m690710fc2d0b"
            title="common.m690710fc2d0b"
            onClick={scrollToBottom}
          >
            <ArrowDown size={18} />
          </button></UiProps>
        )}
      </div>
      {/* 步数到上限而暂停：不是错误，提示点 ▶ 继续执行 */}
      {view.run?.status === "stopped" && view.run.error && !agent.uncertain && agent.error === view.run.error ? (
        <div className={styles.notice} role="status">{uiError(view.run.error)}</div>
      ) : (agent.error || view.run?.status === "failed") && (
        <div className={styles.error} role="alert">
          <CircleAlert size={14} />
          <span>
            {agent.error || <UiText id="common.maa2334167071" />}
            {view.run?.status === "failed" && editableMessageId ? <UiText id="common.m604019a21563" /> : !agent.error ? <UiText id="common.m156e0c374362" /> : ""}
            {agent.uncertain && <UiText id="common.m5108e6b3b42c" />}
          </span>
          <button
            type="button"
            disabled={agent.sending || !agent.online}
            onClick={() =>
              void (agent.uncertain ? agent.send() : agent.reconnect())
            }
          >
            <RotateCcw size={12} />
            {agent.uncertain ? <UiText id="common.m2b61d6f4eaec" /> : <UiText id="common.m802a407c7743" />}
          </button>
        </div>
      )}
      {notice && (
        <div className={styles.toast} role="status">
          {uiLabel(notice)}
        </div>
      )}
      {pendingQuestion && <div className={styles.questionDock}>
        <DecisionCard key={`${pendingQuestion.id}:${pendingQuestion.proposalHash}`} decision={pendingQuestion} busy={agent.decisionBusy} online={agent.online} onAnswer={agent.answer} />
      </div>}
      {!pendingQuestion && platformVideoLink.test(promptValue) && <p className={styles.linkHint} role="note"><UiText id="common.mbdc6d38c69ab" /><button type="button" disabled={locked} onClick={() => fileInput.current?.click()}><UiText id="common.m0b58562cdfb7" /></button><UiText id="common.m2b57e0a4ef6b" /></p>}
      <form
        style={pendingQuestion ? { display: "none" } : undefined}
        ref={composer}
        className={`${styles.composer} ${dragging ? styles.dragging : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files") || locked) return;
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (--dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current = 0;
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <UiProps ids={{"aria-label":["common.m3bbd6fde222a"],"title":["common.m2f7607c96b83"]}}><div
          className={styles.senderResize}
          role="separator"
          tabIndex={0}
          aria-label="common.m3bbd6fde222a"
          aria-orientation="horizontal"
          aria-valuemin={100}
          aria-valuemax={264}
          aria-valuenow={inputHeight}
          title="common.m2f7607c96b83"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            inputResize.current = {
              id: event.pointerId,
              y: event.clientY,
              height: inputHeight,
            };
          }}
          onPointerMove={(event) => {
            const start = inputResize.current;
            if (start?.id === event.pointerId)
              setInputHeight(
                Math.max(
                  100,
                  Math.min(264, start.height + start.y - event.clientY),
                ),
              );
          }}
          onPointerUp={() => {
            inputResize.current = null;
          }}
          onPointerCancel={() => {
            inputResize.current = null;
          }}
          onLostPointerCapture={() => {
            inputResize.current = null;
          }}
          onKeyDown={(event) => {
            if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            setInputHeight((value) =>
              Math.max(
                100,
                Math.min(264, value + (event.key === "ArrowUp" ? 16 : -16)),
              ),
            );
          }}
        /></UiProps>
        {unavailableReferences.map(reference => (
          <p key={creativeAgentReferenceKey(reference)} role="alert" className={styles.draftHint}>
            {reference.label}<UiText id="common.maa86a3697e87" /><IconButton label={text("workspaceFollowup.mbb93d4398c66", { v0: reference.label })} disabled={locked} onClick={() => {
              const asset = composerAssets.find(item => item.reference && creativeAgentReferenceKey(item.reference) === creativeAgentReferenceKey(reference));
              if (asset) removeComposerAsset(asset);
            }}><X size={12} /></IconButton>
          </p>
        ))}
        {attachments.filter(item => item.status === "error").map(item => (
          <p key={item.id} role="alert" className={styles.draftHint}>
            {item.name}：{item.error || <UiText id="common.mb544f2ecc566" />}<UiText id="common.m6d8db23f96b9" /></p>
        ))}
        <div
          data-agent-editor
          onClick={(event) => {
            const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-asset-id]") : null;
            if (target && composerAssets.some(asset => asset.id === target.dataset.assetId)) openAssetPreview(target.dataset.assetId!, target);
          }}
          className={styles.composerEditor}
          style={{ height: inputHeight }}
          onCompositionStartCapture={() => {
            composing.current = true;
          }}
          onCompositionEndCapture={() => {
            composing.current = false;
            compositionEndedAt.current = Date.now();
            requestAnimationFrame(() => {
              const editor = promptEditor.current;
              if (editor && !editor.isDestroyed) updateSuggestions(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc));
            });
          }}
          onKeyDownCapture={(event) => {
            if (event.target instanceof Element && event.target.closest("[contenteditable]")) editorKeyDown(event);
          }}
          onPasteCapture={(event) => {
            if (event.clipboardData.files.length) {
              event.preventDefault();
              addFiles(event.clipboardData.files);
            }
          }}
        >
          <UiProps ids={{"placeholder":["common.m64d039aa251c"]}}><PromptRichEditor
            editorRef={promptEditor}
            ariaLabel={uiLabel("创作要求")}
            value={promptValue}
            assets={composerAssets}
            disabled={locked}
            suggestionsEnabled={false}
            roleSkills={skills}
            selectedRoleSkill={selectedSkill}
            onRoleSkillSelect={selectSkill}
            onRoleSkillRemove={() => {
              selectedSkillIdRef.current = null;
              agent.setSelectedSkillId(null);
              setDraft(promptValue);
            }}
            onValueChange={(value) => {
              const remaining = new Set(findPromptAssetMentions(value, composerAssets).map(mention => mention.asset.id));
              for (const asset of composerAssets) if (inlineAssetIds.has(asset.id) && !remaining.has(asset.id)) removeComposerAsset(asset, false);
              setPromptValue(value);
              updateSuggestions(value);
            }}
            leadingToken={draftSkillId && !selectedSkill ? <RoleSkillTag name={skillsLoading ? "正在加载技能…" : "技能不可用"}><UiProps ids={{"aria-label":["common.m1324d3de0b04"]}}><button type="button" className="ml-1 inline-flex border-0 bg-transparent p-0 text-inherit" aria-label="common.m1324d3de0b04" onClick={() => { selectedSkillIdRef.current = null; agent.setSelectedSkillId(null); setDraft(promptValue); }}><X size={12} /></button></UiProps></RoleSkillTag> : undefined}
            placeholder="common.m64d039aa251c"
            variant="canvasGenerator"
            className={styles.promptEditor}
            contentClassName={styles.promptEditorContent}
          /></UiProps>
        </div>
        <div className={styles.composerFooter}>
          <div className={styles.composerActions}>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={AGENT_ATTACHMENT_ACCEPT}
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <UiProps ids={{"label":["common.mc8a47d001848"]}}><IconButton
              label="common.mc8a47d001848"
              tooltip
              disabled={locked}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={16} />
            </IconButton></UiProps>
            <UiProps ids={{"label":["common.m71d08dcf4ffe"]}}><IconButton
              label="common.m71d08dcf4ffe"
              tooltip
              data-agent-menu-trigger
              disabled={locked}
              aria-expanded={menu === "mentions"}
              onClick={() => openMenu("mentions")}
            >
              <AtSign size={16} />
            </IconButton></UiProps>
            <UiProps ids={{"label":["common.m4883034623cc"]}}><IconButton
              label="common.m4883034623cc"
              tooltip
              data-agent-menu-trigger
              data-skill-selected={Boolean(draftSkillId)}
              disabled={locked}
              aria-expanded={menu === "skills"}
              onClick={() => openMenu("skills")}
            >
              <SkillModuleIcon width={16} height={16} />
            </IconButton></UiProps>
            <span className={styles.preferenceHover} data-muted={preferenceCardMuted || undefined} onMouseEnter={placePreferenceCard} onFocus={placePreferenceCard} onMouseLeave={() => setPreferenceCardMuted(false)} onBlur={() => setPreferenceCardMuted(false)}>
              <button
                ref={preferenceTrigger}
                type="button"
                className={styles.creationPreferencesTrigger}
                aria-haspopup="dialog"
                aria-expanded={dialog === "settings"}
                aria-describedby={preferenceSummaryId}
                onClick={() => {
                  setDialog("settings");
                  setMenu(null);
                }}
              >
                <SlidersHorizontal size={16} />
                <span><UiText id="common.m88facbb4c728" /></span>
              </button>
              <span id={preferenceSummaryId} role="tooltip" className={styles.preferenceCard} style={preferenceCardPlace ?? undefined}>
                {preferenceSummary.map(([label, value]) => <span key={label}><span>{label}：</span>{value}</span>)}
              </span>
            </span>
          </div>
          <span className={styles.composerSpacer} />
          <div className={styles.composerActions}>
            <UiProps ids={{"label":["common.m2d9df64ac065"]}}><IconButton
              label={contextPercent != null ? text("workspaceFollowup.ma3ee4b0394de", { v0: contextPercent < 1 ? "<1" : Math.round(contextPercent) }) : "common.m2d9df64ac065"}
              tooltip
              data-agent-menu-trigger
              data-context-trigger
              aria-expanded={menu === "context"}
              onClick={() => {const opening = menu !== "context";openMenu("context");if (opening) void agent.refreshUsage().catch(() => setNotice("用量暂未刷新，请稍后重试。"));}}
            >
              <ContextRing percent={contextPercent} />
            </IconButton></UiProps>
            <UiProps ids={{"aria-label":["common.m9ad0aac32ea3","common.m39be5cf61df9","common.m4a159aea7811"],"title":["common.m9ad0aac32ea3","common.ma188d9affcdd","common.mef8331b75b52"]}}><button
              type={active || resumable ? "button" : "submit"}
              className={styles.send}
              aria-label={active ? "common.m9ad0aac32ea3" : resumable ? "common.m39be5cf61df9" : "common.m4a159aea7811"}
              title={
                active
                  ? "common.m9ad0aac32ea3"
                  : resumable
                    ? "common.ma188d9affcdd"
                    : "common.mef8331b75b52"
              }
              disabled={
                active
                  ? agent.controlBusy ||
                    !agent.online ||
                    view.run?.status === "stopping"
                  : resumable
                    ? agent.controlBusy
                    : !canSend
              }
              onClick={
                active
                  ? () => void agent.control("stop")
                  : resumable
                    ? () => void agent.control("continue")
                    : undefined
              }
            >
              {active ? (
                <Square size={12} fill="currentColor" />
              ) : resumable ? (
                <Play size={14} fill="currentColor" />
              ) : (
                <ArrowUp size={18} />
              )}
            </button></UiProps>
          </div>
        </div>
        {dragging && (
          <div className={styles.dropHint}>
            <Paperclip size={22} />
            <strong><UiText id="common.med4da5d61c5e" /></strong>
            <small><UiText id="common.m97540cf79a91" /></small>
          </div>
        )}
        {menu === "skills" && props.visible !== false && skillPopupPosition && createPortal(
          <UiProps ids={{"aria-label":["common.mbb846c69627f"]}}><div
            ref={skillPopup}
            className={styles.skillPopup}
            style={skillPopupPosition}
            data-agent-popup
            role="dialog"
            aria-label="common.mbb846c69627f"
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <RoleSkillPicker
              items={filteredSkills}
              loading={skillsLoading}
              error={skillsError}
              source={skillTab}
              onSourceChange={(source) => { skillTabs.set(skillTabKey, source); setSkillTab(source); setActiveOption(0); }}
              query={query}
              onQueryChange={(value) => { setQuery(value); setActiveOption(0); }}
              activeIndex={activeOption}
              scrollMemoryKey={skillTabKey}
              keyboardNavigationVersion={skillKeyboardNavigation}
              onActiveIndexChange={setActiveOption}
              onSelect={selectSkill}
              onCreate={() => { setMenu(null); setSkillLibraryView("create"); setSkillLibraryOpen(true); }}
              onBrowse={() => { setMenu(null); setSkillLibraryView("browse"); setSkillLibraryOpen(true); }}
              onView={(skill) => {
                setMenu(null); setEditingSkill(skill); setSkillLibraryView("detail"); setSkillLibraryOpen(true);
              }}
              onSearchKeyDown={editorKeyDown}
              listId={`agent-composer-options-${props.sessionId}`}
            />
          </div></UiProps>,
          document.body,
        )}
        {menu && menu !== "history" && menu !== "skills" && (
          <div
            className={`${styles.popup} ${styles.composerPopup} ${menu === "context" ? styles.contextPopup : styles.mentionsPopup}`}
            style={menu === "context" && contextAnchor ? contextAnchor : undefined}
            data-agent-popup
            role="dialog"
            aria-label={
              {
                mentions: text("workspaceFollowup.m25c1724a305a"),
                context: text("workspaceFollowup.m2d9df64ac065"),
              }[menu]
            }
          >
            {menu === "mentions" && (
              <div className={styles.mentionHeader}>
                <div className={styles.mentionTabs}>
                  {[
                    { id: "canvas", label: "当前画布" },
                    { id: "selected", label: "已选引用" },
                    { id: "assets", label: "全局素材" },
                    { id: "library", label: "素材库" },
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      aria-pressed={scope === item.id}
                      onClick={() => {
                        mentionScopes.set(mentionScopeKey, item.id);
                        setScope(item.id);
                        setActiveOption(0);
                      }}
                    >
                      {uiLabel(item.label)}
                    </button>
                  ))}
                </div>
                <UiProps ids={{"label":["common.mbe0d5706c694"]}}><IconButton label="common.mbe0d5706c694" onClick={() => setMenu(null)}>
                  <X size={12} />
                </IconButton></UiProps>
              </div>
            )}
            <div className={styles.menuList} id={`agent-composer-options-${props.sessionId}`}>
              {menu === "mentions" &&
                (scope === "library" ? (
                  <AgentMaterialLibraryPicker
                    key={authUserId}
                    ownerId={Number(authUserId)}
                    query={query}
                    disabled={locked}
                    selectedIds={attachments.flatMap((item) => item.materialId ? [item.materialId] : [])}
                    onSelect={selectLibraryMaterial}
                  />
                ) : scope === "assets" ? (
                  <p className={styles.menuHint}><UiText id="common.me65bbd6502d0" /></p>
                ) : filteredReferences.length ? (
                  filteredReferences.map((item, index) => (
                    <button
                      key={creativeAgentReferenceKey(item)}
                      id={`agent-${props.sessionId}-option-${index}`}
                      type="button"
                      className={`${styles.menuItem} ${index === activeOption ? styles.menuActive : ""}`}
                      aria-label={item.label}
                      title={`${item.label} · ${item.outputId ? text("workspaceFollowup.mf2b745bab035") : text("workspaceFollowup.m77b1beecd7ff")}`}
                      onMouseEnter={() => setActiveOption(index)}
                      onClick={() => selectReference(item)}
                    >
                      <div className={styles.mentionThumbnail}><AgentReferenceThumbnail preview={props.onGetReferencePreview?.(item)} name={item.label} /></div>
                      <span>
                        <strong>{item.label}</strong>
                      </span>
                      {selectedReferences.some(
                        (ref) => creativeAgentReferenceKey(ref) === creativeAgentReferenceKey(item),
                      ) && <Check size={14} />}
                    </button>
                  ))
                ) : (
                  <p className={styles.menuHint}>
                    {query ? <UiText id="common.m91e71514476c" /> : <UiText id="common.m628a871a69d9" />}
                  </p>
                ))}
              {menu === "context" && (
                <AgentUsage usage={view.usage} scopes={view.usageScopes} contextWindow={chatModel?.contextWindow} modelLabel={chatModel ? chatModel.label?.replace(/^.+? · /, "") || chatModel.modelId : undefined} />
              )}
            </div>
          </div>
        )}
        {preview && previewAsset && <UiProps ids={{"aria-label":["common.m41f5a2620e4b"]}}><section data-agent-preview className={styles.materialPreview} style={{ left: preview.left, bottom: preview.bottom }} role="dialog" aria-label="common.m41f5a2620e4b">
          <div className={styles.materialPreviewMedia}>
            {previewAsset.preview?.kind === "image" && previewAsset.preview.url ? <MediaImage src={previewAsset.preview.url} alt={previewAsset.name || previewAsset.token} />
              : previewAsset.preview?.kind === "video" && previewAsset.preview.url ? <video src={previewAsset.preview.url} controls playsInline />
              : previewAsset.preview?.kind === "audio" && previewAsset.preview.url ? <audio src={previewAsset.preview.url} controls />
              : <AgentReferenceThumbnail preview={previewAsset.preview} name={previewAsset.name || previewAsset.token} />}
          </div>
          <div className={styles.materialPreviewFooter}>
            <span title={previewAsset.name}>{previewAsset.name}</span>
            <IconButton label={text("workspaceFollowup.ma543575dca4b", { v0: previewAsset.reference ? text("workspaceFollowup.me0ec651f0dae") : text("workspaceFollowup.mc7225dbf105e"), v1: previewAsset.name || previewAsset.token })} disabled={locked} onClick={() => removeComposerAsset(previewAsset)}><X size={12} /></IconButton>
          </div>
          {previewAsset.attachment && previewAsset.attachment.status !== "ready" && <p className={styles.menuHint}>{previewAsset.attachment.error || <UiText id="common.m11fd0197db9f" />}</p>}
        </section></UiProps>}
      </form>
      {dialog && preferenceRecord?.key === preferenceKey && <CreationPreferencesPanel
        key={preferenceKey}
        anchorRef={preferenceTrigger}
        composerRef={composer}
        value={preferences}
        initialTab={preferenceTab}
        onTabChange={setPreferenceTab}
        catalog={models}
        loading={modelLoading}
        error={modelError}
        onRetryCatalog={() => setCatalogRetry(value => value + 1)}
        onClose={() => setDialog(null)}
        onChange={value => {
          setPreferenceRecord({ key: preferenceKey, value });
          saveCreationPreferences(preferenceKey, value);
        }}
      />}
    </aside></UiProps>
      <UiProps ids={{"title":["common.m96ac766097fb"],"confirmText":["common.m615d1b33ea06"]}}><ConfirmDialog open={Boolean(deletingSkill)} zIndex={200} title="common.m96ac766097fb"
        description={text("workspaceFollowup.me4b61db40085", { v0: deletingSkill?.name || "" })}
        danger confirmText="common.m615d1b33ea06" onClose={() => setDeletingSkill(null)}
        onConfirm={async () => {
          if (!deletingSkill || deletingSkill.source !== "personal") return false;
          try {
            await deletePersonalRoleSkillClient(deletingSkill.id, deletingSkill.revision);
            knownSkills.current.delete(deletingSkill.id);
            if (draftSkillId === deletingSkill.id) { selectedSkillIdRef.current = null; agent.setSelectedSkillId(null); setDraft(promptValue); }
            removeFavoriteSkill(deletingSkill.id);
            await refreshSkills();
            setSkillLibraryOpen(false);
            return true;
          } catch (error) {
            setSkillDeleteError(error instanceof Error ? error.message : "删除技能失败");
            return false;
          }
        }}>
        {skillDeleteError && <p role="alert">{skillDeleteError}</p>}
      </ConfirmDialog></UiProps>
      <RoleSkillDialog open={skillLibraryOpen} initialView={skillLibraryView} initialSkill={editingSkill} purpose="agent" authUserId={authUserId} mediaType="text"
        selectedRoleSkillId={draftSkillId} resultRoleSkillId={null}
        legacySystemPrompt="" result={null} generating={false}
        onClose={() => setSkillLibraryOpen(false)} onSelect={(skill) => { selectSkill(skill); void refreshSkills(); }}
        onEditSkill={(skill) => { setEditingSkill(skill); setSkillLibraryView("edit"); }}
        onDeleteSkill={(skill) => { setSkillDeleteError(""); setDeletingSkill(skill); }}
        onGenerate={() => {}} onApplyResult={() => {}} />
    </>
  );
}
