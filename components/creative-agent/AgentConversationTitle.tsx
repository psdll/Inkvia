"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import type { ConversationTabs } from "./use-conversation-tabs";
import styles from "./canvas-agent.module.css";

export function AgentConversationTitle({ tabs, sessionId }: { tabs: ConversationTabs; sessionId: string }) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const saving = React.useRef(false);
  const save = () => {
    if (!editing || saving.current) return;
    saving.current = true;
    if (draft.trim()) void tabs.rename(editing, draft.trim()).finally(() => { saving.current = false; });
    else saving.current = false;
    setEditing(null);
  };
  const session = tabs.sessions.find(item => item.id === sessionId);
  if (!session) return null;

  return (
    <div className={styles.conversationHeading}>
      {editing === sessionId ? (
        <UiProps ids={{"aria-label":["common.m26c4fa32203a"]}}><input
          className={styles.titleInput}
          autoFocus
          maxLength={80}
          aria-label="common.m26c4fa32203a"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") { event.preventDefault(); save(); }
            if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
          }}
        /></UiProps>
      ) : (
        <button
          type="button"
          data-agent-title
          aria-label={`当前对话：${session.title}`}
          className={styles.conversationTitle}
          title={session.title}
          onDoubleClick={() => { setDraft(session.title); setEditing(sessionId); }}
          onKeyDown={event => {
            if (event.key === "F2") { event.preventDefault(); setDraft(session.title); setEditing(sessionId); }
          }}
        >{session.title}</button>
      )}
    </div>
  );
}
