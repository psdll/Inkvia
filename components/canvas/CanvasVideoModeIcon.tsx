import * as React from "react";

const modeShapes: Record<string, React.ReactNode> = {
  text_to_video: <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M6 9V8h7v1M9.5 8v8M7.5 16h4" />
    <path d="m16 9 3 3-3 3Z" fill="currentColor" stroke="none" />
  </>,
  multimodal: <>
    <path d="M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M5 16l3-5 4 5" />
    <circle cx="7" cy="7" r="1" fill="currentColor" stroke="none" />
    <path d="m15 6 4 3-4 3Z" fill="currentColor" stroke="none" />
    <path d="M19 19v-5l3 1" />
    <ellipse cx="17" cy="19" rx="2" ry="1.5" fill="currentColor" stroke="none" />
  </>,
  first_frame: <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M6 4v16M8 17l4-5 4 5h3" />
    <circle cx="10" cy="8" r="1" fill="currentColor" stroke="none" />
    <path d="m16 7 3 2.5-3 2.5Z" fill="currentColor" stroke="none" />
  </>,
  first_last_frame: <>
    <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1M4 12l3-4 2 2" />
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="m11 18 3-4 5 4" />
    <circle cx="17" cy="12" r="1" fill="currentColor" stroke="none" />
  </>,
  edit: <>
    <path d="M10 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3" />
    <path d="m7 8 5 3-5 3Z" fill="currentColor" stroke="none" />
    <path d="m14 16 5-5 3 3-5 5-4 1ZM17 13l3 3" />
  </>,
  extend: <>
    <path d="M9 18H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5" />
    <path d="m8 7 6 4-6 4Z" fill="currentColor" stroke="none" />
    <path d="M12 18h10m-4-4 4 4-4 4" />
  </>,
};

export function CanvasVideoModeIcon({ value }: { value: string }) {
  return (
    <svg className="canvas-video-mode-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {modeShapes[value]}
    </svg>
  );
}
