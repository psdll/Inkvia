"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Mouse, MousePointer2, Move, Sparkles, SquareMousePointer, Touchpad, ZoomIn, type LucideIcon } from "lucide-react";
import "./canvas-shortcuts.css";

type GestureIconKind = "touchpad" | "mouse" | "pointer";
type Gesture = { icon: GestureIconKind; text: string };
type Shortcut = { label: string; keys?: string[]; gesture?: Gesture; suffix?: string };

const sections: { title: string; icon: LucideIcon; shortcuts: Shortcut[] }[] = [
  { title: "创作", icon: Sparkles, shortcuts: [
    { label: "成组", keys: ["Ctrl/Alt", "G"] },
    { label: "解组", keys: ["Ctrl/Alt", "Shift", "G"] },
    { label: "新建节点", keys: ["Tab"] },
    { label: "连线", keys: ["Ctrl", "L"] },
    { label: "生成", keys: ["Ctrl", "Enter"] },
    { label: "复制节点和连线", keys: ["Ctrl", "D"] },
    { label: "拖动复制", keys: ["Alt"], suffix: "+拖动节点" },
    { label: "创建副本（含内部连线）", keys: ["Ctrl", "Alt"], suffix: "+拖动" },
    { label: "复制并保留输入连线", keys: ["Shift", "Alt"], suffix: "+拖动" },
    { label: "框选组内节点", keys: ["Ctrl"], suffix: "+在组内空白处拖动" },
    { label: "选择或拖动整组", suffix: "组内空白处点击或拖动" },
  ] },
  { title: "缩放", icon: ZoomIn, shortcuts: [
    { label: "放大", keys: ["Ctrl", "+"] },
    { label: "缩小", keys: ["Ctrl", "−"] },
    { label: "适应画布", keys: ["Ctrl", "0"] },
    { label: "快速适应画布", keys: ["Z"] },
    { label: "触控板", gesture: { icon: "touchpad", text: "双指捏合" } },
    { label: "鼠标", keys: ["Ctrl"], gesture: { icon: "mouse", text: "滚轮" } },
  ] },
  { title: "移动画布", icon: Move, shortcuts: [
    { label: "键盘", keys: ["Space"], gesture: { icon: "pointer", text: "拖动" } },
    { label: "触控板", gesture: { icon: "touchpad", text: "双指滑动" } },
    { label: "鼠标滚轮", gesture: { icon: "mouse", text: "滚动" } },
    { label: "鼠标中键", gesture: { icon: "mouse", text: "按住拖动" } },
    { label: "移动", keys: ["V"] },
    { label: "抓手工具", keys: ["H"] },
    { label: "整理画布", keys: ["Alt", "Shift", "F"] },
  ] },
  { title: "其他", icon: SquareMousePointer, shortcuts: [
    { label: "全选", keys: ["Ctrl", "A"] },
    { label: "多选", keys: ["Shift"], suffix: "+点击" },
    { label: "框选", suffix: "空白处拖动" },
    { label: "复制", keys: ["Ctrl", "C"] },
    { label: "粘贴节点或图片", keys: ["Ctrl", "V"] },
    { label: "删除", keys: ["Backspace"] },
    { label: "撤销", keys: ["Ctrl", "Z"] },
    { label: "重做", keys: ["Ctrl", "Shift", "Z"] },
    { label: "打开或关闭素材库", keys: ["A"] },
    { label: "取消选择或关闭面板", keys: ["Esc"] },
  ] },
];

const gestureIcons: Record<GestureIconKind, LucideIcon> = { touchpad: Touchpad, mouse: Mouse, pointer: MousePointer2 };

function GestureChip({ gesture }: { gesture: Gesture }) {
  const { label: uiLabel } = useUiLocale();
  const Icon = gestureIcons[gesture.icon];
  return (
    <span className="canvas-shortcut-gesture">
      <Icon aria-hidden="true" size={15} strokeWidth={1.6} />
      {uiLabel(gesture.text)}
    </span>
  );
}

function Keycap({ value }: { value: string }) {
  return <kbd className="canvas-shortcut-key" aria-label={value === "Backspace" ? "Delete / Backspace" : value}>
    {value === "Backspace" ? <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="m7.333 6 4 4m0-4-4 4M5.333 3.333a1.333 1.333 0 0 0-.896.346L1.552 7.505a.667.667 0 0 0 0 .987l2.885 3.827c.245.223.565.346.896.346h8a1.333 1.333 0 0 0 1.334-1.333V4.665a1.333 1.333 0 0 0-1.334-1.332h-8Z" stroke="var(--canvas-controls-icon)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg> : value === "+" || value === "−" ? <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d={value === "+" ? "M8 .667v14.666M.667 8h14.666" : "M1.833 8h11.867"} stroke="var(--canvas-controls-icon)" strokeWidth="1.2" /></svg> : value}
  </kbd>;
}

export default function CanvasShortcutPanel({ onClose, anchorRef }: { onClose: () => void; anchorRef: React.RefObject<HTMLButtonElement> }) {
  const { label: uiLabel } = useUiLocale();
  const panelRef = React.useRef<HTMLElement>(null);
  const [anchorX, setAnchorX] = React.useState<number>();
  const [mac, setMac] = React.useState(false);
  React.useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const updateAnchor = () => {
      const panel = panelRef.current?.getBoundingClientRect();
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (panel && anchor) setAnchorX(Math.max(16, Math.min(panel.width - 16, anchor.left + anchor.width / 2 - panel.left)));
    };
    updateAnchor();
    const observer = new ResizeObserver(updateAnchor);
    if (panelRef.current) observer.observe(panelRef.current);
    if (panelRef.current?.parentElement) observer.observe(panelRef.current.parentElement);
    window.addEventListener("resize", updateAnchor);
    return () => { observer.disconnect(); window.removeEventListener("resize", updateAnchor); };
  }, [anchorRef]);

  return (
    <UiProps ids={{"aria-label":["canvas.mee2638183d3e"]}}><aside ref={panelRef} data-canvas-shortcut-panel aria-label="canvas.mee2638183d3e" className="canvas-shortcut-panel nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <UiProps ids={{"aria-label":["canvas.m96001f317d8e"]}}><button type="button" onClick={onClose} aria-label="canvas.m96001f317d8e" className="canvas-shortcut-close"><svg aria-hidden="true" width="13" height="13" viewBox="0 0 17 17" fill="none"><path d="m1 1 15 15M16 1 1 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></button></UiProps>
      <div className="canvas-shortcut-columns">
        {sections.map(section => <section key={section.title} className="canvas-shortcut-section">
          <h3><span className="canvas-shortcut-heading-icon"><section.icon aria-hidden="true" size={14} strokeWidth={1.8} /></span>{uiLabel(section.title)}</h3>
          <div className="canvas-shortcut-rows">{section.shortcuts.map(shortcut => <div key={shortcut.label} className="canvas-shortcut-row">
            <span className="canvas-shortcut-label">{uiLabel(shortcut.label)}</span>
            <div className="canvas-shortcut-combination">
              {shortcut.keys?.map((key, index) => <React.Fragment key={`${key}-${index}`}>
                {index > 0 && <span className="canvas-shortcut-plus">+</span>}
                <Keycap value={mac ? key.replace("Ctrl", "⌘").replace("Alt", "⌥") : key} />
              </React.Fragment>)}
              {shortcut.gesture && <>{shortcut.keys?.length ? <span className="canvas-shortcut-plus">+</span> : null}<GestureChip gesture={shortcut.gesture} /></>}
              {uiLabel(shortcut.suffix || "")}
            </div>
          </div>)}</div>
        </section>)}
      </div>
      <span aria-hidden="true" className="canvas-shortcut-arrow" style={{ left: anchorX ?? "50%" }}><svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M0 2 6.6 8.4a2 2 0 0 0 2.8 0L16 2" fill="var(--canvas-controls-bg)" stroke="var(--canvas-controls-border)" strokeWidth="1" strokeLinecap="round" /><path d="M0 0h16v2H0z" fill="var(--canvas-controls-bg)" /></svg></span>
    </aside></UiProps>
  );
}
