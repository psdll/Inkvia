"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { structuredQuestionAnswerSchema, validateQuestionAnswer, type DecisionAnswer, type QuestionAnswer, type QuestionField, type QuestionValue } from "@/lib/creative-agent/questions";
import styles from "./canvas-agent.module.css";

type QuestionDraft = Extract<QuestionAnswer, { values: unknown }>;

export default function QuestionForm({ id, proposalHash, fields, disabled, onAnswer, allowNote = true }: {
  id: string; proposalHash: string; fields: QuestionField[]; disabled: boolean;
  onAnswer: (answer: DecisionAnswer) => Promise<boolean | void>;
  allowNote?: boolean;
}) {
  const { label: uiLabel, error: uiError } = useUiLocale();
  const storageKey = `creative-agent-question:${id}:${proposalHash}`;
  const [draft, setDraft] = React.useState<QuestionDraft>(() => {
    try {
      const saved = structuredQuestionAnswerSchema.safeParse(JSON.parse(sessionStorage.getItem(storageKey) || "null"));
      if (saved.success && "values" in saved.data) return saved.data;
    } catch { /* Storage is optional; the server owns the submitted answer. */ }
    return { values: {} };
  });
  const [page, setPage] = React.useState(() => {
    try { return Math.max(0, Math.min(fields.length - 1, Number(sessionStorage.getItem(`${storageKey}:page`)) || 0)); }
    catch { return 0; }
  });
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const pending = React.useRef(false);
  const locked = disabled || submitting;
  const field = fields[page];
  const value = draft.values[field.id];
  const inputId = `${id}-${field.id}`;
  const lastPage = page === fields.length - 1;
  React.useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
      sessionStorage.setItem(`${storageKey}:page`, String(page));
    } catch { /* Private browsing may disable storage. */ }
  }, [draft, page, storageKey]);
  const navigate = (index: number) => { setError(""); setPage(index); };
  const update = (next: QuestionValue | undefined) => {
    setError("");
    setDraft(current => {
      const values = { ...current.values };
      if (next === undefined) delete values[field.id]; else values[field.id] = next;
      const skippedFields = current.skippedFields?.filter(id => id !== field.id);
      return { ...current, values, ...(skippedFields ? { skippedFields } : {}) };
    });
  };
  const updateNote = (note: string) => {
    setError("");
    setDraft(current => {
      const notes = { ...current.notes };
      if (note) notes[field.id] = note; else delete notes[field.id];
      const skippedFields = current.skippedFields?.filter(id => id !== field.id);
      return { ...current, notes, ...(skippedFields ? { skippedFields } : {}) };
    });
  };
  const advance = async (ignore = false) => {
    if (disabled || pending.current) return;
    const next = { ...draft, values: { ...draft.values } };
    if (ignore) {
      delete next.values[field.id];
      if (next.notes) { next.notes = { ...next.notes }; delete next.notes[field.id]; }
      next.skippedFields = [...new Set([...(next.skippedFields || []), field.id])];
      setDraft(next);
    }
    const validateField = (item: QuestionField) => validateQuestionAnswer([item], {
      values: next.values[item.id] === undefined ? {} : { [item.id]: next.values[item.id] },
      ...(next.notes?.[item.id] !== undefined ? { notes: { [item.id]: next.notes[item.id] } } : {}),
      ...(next.skippedFields?.includes(item.id) ? { skippedFields: [item.id] } : {}),
    });
    try {
      if (!lastPage) {
        validateField(field);
        navigate(page + 1);
        return;
      }
      // Arrow navigation may leave earlier questions unanswered; return to the first one.
      for (let index = 0; index < fields.length; index++) {
        const item = fields[index];
        try { validateField(item); }
        catch (reason) { setPage(index); throw reason; }
      }
      const answer = validateQuestionAnswer(fields, next.skippedFields?.length === fields.length && !next.note?.trim() ? { skipped: true } : next);
      pending.current = true;
      setSubmitting(true);
      const accepted = await onAnswer(answer);
      if (accepted !== false) {
        try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(`${storageKey}:page`); } catch { /* Optional storage. */ }
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "请检查回答后重试"); }
    finally { pending.current = false; setSubmitting(false); }
  };
  const choices: QuestionField["options"] = field.type === "switch" ? [{ value: "true", label: "是" }, { value: "false", label: "否" }] : field.options;
  return <UiProps ids={{"aria-label":["common.m4a683b97817b"]}}><form className={styles.questionForm} noValidate aria-label="common.m4a683b97817b" onSubmit={event => { event.preventDefault(); void advance(); }}>
    <div className={styles.questionHeading}>
      <h3 id={`${inputId}-title`}>{uiLabel(field.title)}</h3>
      <UiProps ids={{"aria-label":["common.m2393def040af"]}}><div className={styles.questionPagination} aria-label="common.m2393def040af">
        <UiProps ids={{"aria-label":["common.m39b1c2253dc3"]}}><button type="button" aria-label="common.m39b1c2253dc3" disabled={locked || page === 0} onClick={() => navigate(page - 1)}><ChevronLeft size={16} /></button></UiProps>
        <span>{page + 1}/{fields.length}</span>
        <UiProps ids={{"aria-label":["common.mf82c68c72b8f"]}}><button type="button" aria-label="common.mf82c68c72b8f" disabled={locked || lastPage} onClick={() => navigate(page + 1)}><ChevronRight size={16} /></button></UiProps>
      </div></UiProps>
    </div>
    <fieldset className={styles.questionField} disabled={locked} aria-labelledby={`${inputId}-title`}>
      {field.description && <p className={styles.questionDescription}>{uiLabel(field.description)}</p>}
      {choices ? <div className={styles.questionChoices}>
        {choices.map((option, index) => {
          const selected = field.type === "checkbox" ? Array.isArray(value) && value.includes(option.value) : field.type === "switch" ? value === (option.value === "true") : value === option.value;
          return <label className={styles.questionChoice} key={option.value} data-selected={selected || undefined}>
            <input type={field.type === "checkbox" ? "checkbox" : "radio"} name={inputId} value={option.value} checked={selected}
              onChange={event => update(field.type === "checkbox" ? event.target.checked ? [...(Array.isArray(value) ? value : []), option.value] : (Array.isArray(value) ? value : []).filter(item => item !== option.value) : field.type === "switch" ? option.value === "true" : option.value)} />
            <span className={styles.questionNumber} aria-hidden="true">{index + 1}</span>
            <span>{uiLabel(option.label)}{"recommended" in option && option.recommended && <small className={styles.questionRecommendation}><UiText id="common.m1452deafc6d9" /></small>}{"description" in option && option.description && <small className={styles.questionDescription}>{uiLabel(option.description)}</small>}</span>
          </label>;
        })}
      </div> : field.type === "textarea" ? <UiProps ids={{"placeholder":["common.m96c5bdd46d76"]}}><textarea id={inputId} aria-label={uiLabel(field.title)} rows={3} maxLength={2000} placeholder={field.placeholder || "common.m96c5bdd46d76"} value={typeof value === "string" ? value : ""} onChange={event => update(event.target.value)} /></UiProps>
        : <UiProps ids={{"placeholder":["common.m96c5bdd46d76"]}}><input id={inputId} aria-label={uiLabel(field.title)} type={field.type === "number" ? "number" : "text"} step={field.type === "number" ? "any" : undefined} maxLength={2000} placeholder={field.placeholder || "common.m96c5bdd46d76"} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={event => update(field.type === "number" ? event.target.value === "" ? undefined : Number(event.target.value) : event.target.value)} /></UiProps>}
      {draft.skippedFields?.includes(field.id) && <p className={styles.questionDescription}><UiText id="common.ma020a4b446de" /></p>}
    </fieldset>
    {allowNote && <details className={styles.questionNote}>
      <summary><UiText id="common.m6f3ebd2d3e87" /></summary>
      <UiProps ids={{"aria-label":["common.m6f3ebd2d3e87"],"placeholder":["common.me95d4f0150c9"]}}><textarea aria-label="common.m6f3ebd2d3e87" aria-describedby={`${inputId}-title`} rows={2} maxLength={2000} disabled={locked} value={draft.notes?.[field.id] || ""} placeholder="common.me95d4f0150c9" onChange={event => updateNote(event.target.value)} /></UiProps>
    </details>}
    {error && <p role="alert" className={styles.questionError}>{uiError(error)}</p>}
    <div className={styles.questionActions}>
      <UiProps ids={{"aria-label":["common.m18ef2b029173"]}}><button type="button" aria-label="common.m18ef2b029173" disabled={locked} onClick={() => void advance(true)}><UiText id="common.m6e90ac940752" /></button></UiProps>
      <button type="submit" disabled={locked} className={styles.questionSubmit}>{submitting ? <UiText id="common.m18931020ad52" /> : <UiText id="common.m7c9691192f1b" />}</button>
    </div>
  </form></UiProps>;
}
