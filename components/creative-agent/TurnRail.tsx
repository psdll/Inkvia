"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import styles from "./canvas-agent.module.css";

export type TurnRailItem = { id: string; text: string };

const anchorOf = (container: HTMLElement, id: string) => Array.from(container.querySelectorAll<HTMLElement>("[data-turn-anchor]")).find(element => element.dataset.turnAnchor === id);

/**
 * 对话导航：对话区左边缘每条短线代表一轮提问，当前看到的那轮加长加深。
 * 悬停或键盘聚焦时展开问题列表，点击跳到那一轮。少于两轮时不显示。
 */
export function TurnRail({ items, container }: { items: TurnRailItem[]; container: React.RefObject<HTMLDivElement | null> }) {
  const [active, setActive] = React.useState<string>();
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const latest = React.useRef(items);
  latest.current = items;
  const ids = items.map(item => item.id).join("|");

  React.useEffect(() => {
    const node = container.current;
    if (!node) return;
    let frame = 0;
    // 以视口上部三分之一为准：标题已滚进来的最后一轮就是当前轮；滚到底时是最后一轮
    const update = () => {
      frame = 0;
      const list = latest.current;
      const top = node.getBoundingClientRect().top;
      const anchors = new Map(Array.from(node.querySelectorAll<HTMLElement>("[data-turn-anchor]")).map(element => [element.dataset.turnAnchor, element]));
      let current: string | undefined = list[0]?.id;
      for (const item of list) {
        const anchor = anchors.get(item.id);
        if (!anchor) continue;
        if (anchor.getBoundingClientRect().top - top <= node.clientHeight / 3) current = item.id;
        else break;
      }
      if (node.scrollHeight - node.scrollTop - node.clientHeight < 8) current = list.at(-1)?.id;
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    node.addEventListener("scroll", schedule, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    resize?.observe(node);
    return () => { node.removeEventListener("scroll", schedule); resize?.disconnect(); cancelAnimationFrame(frame); };
  }, [container, ids]);
  React.useEffect(() => () => clearTimeout(closeTimer.current), []);

  if (items.length < 2) return null;
  const jump = (id: string) => {
    const node = container.current;
    const anchor = node && anchorOf(node, id);
    if (!node || !anchor) return;
    node.scrollTo({ top: node.scrollTop + anchor.getBoundingClientRect().top - node.getBoundingClientRect().top - 12, behavior: "smooth" });
    setActive(id);
  };
  const show = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const hide = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 160); };

  return (
    <UiProps ids={{"aria-label":["common.m4351e7b5ec89"]}}><nav className={styles.turnRail} aria-label="common.m4351e7b5ec89" data-open={open || undefined}
      onMouseEnter={show} onMouseLeave={hide} onFocus={show}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}>
      <div className={styles.turnRailTicks}>
        {items.map((item, index) => (
          <button key={item.id} type="button" className={styles.turnRailTick} data-active={item.id === active || undefined}
            aria-current={item.id === active ? "true" : undefined} aria-label={`第 ${index + 1} 轮提问：${item.text}`} onClick={() => jump(item.id)} />
        ))}
      </div>
      {open && (
        <div className={styles.turnRailMenu} aria-hidden="true">
          {items.map((item, index) => (
            <button key={item.id} type="button" tabIndex={-1} data-active={item.id === active || undefined} onClick={() => { jump(item.id); setOpen(false); }}>
              <span>{index + 1}</span><span>{item.text}</span>
            </button>
          ))}
        </div>
      )}
    </nav></UiProps>
  );
}
