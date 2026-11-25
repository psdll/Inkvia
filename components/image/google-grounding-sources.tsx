"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { ArrowUpRight, ChevronDown, Globe2, Link2 } from "lucide-react";
import type { GoogleGrounding } from "@/lib/google-image-settings";

// Keep Google's markup and branding; let search chips wrap inside narrow detail panels.
const suggestionStyles = `
html,body{background:transparent!important}body{margin:0;color:CanvasText;font-family:system-ui,sans-serif}
.container{align-items:flex-start!important;gap:10px;padding:0!important;box-shadow:none!important;background:transparent!important;min-width:0}
.headline{flex-shrink:0;margin:8px 0 0!important}.gradient-container{display:none}
.carousel{display:flex!important;flex:1;flex-wrap:wrap;gap:6px;min-width:0;overflow:visible!important;white-space:normal!important;margin:0!important}
.chip{box-sizing:border-box;max-width:100%;min-width:0!important;white-space:normal!important;overflow-wrap:anywhere;text-align:left!important;margin:0!important;padding:7px 10px!important;border-radius:10px!important;font-size:12px;line-height:18px}
a:focus-visible{outline:2px solid #669df6;outline-offset:2px}
`;

function GoogleSearchSuggestions({ html }: { html: string }) {
  const [height, setHeight] = React.useState(48);
  const observer = React.useRef<ResizeObserver | null>(null);
  React.useEffect(() => () => observer.current?.disconnect(), []);
  const measureOnLoad = (event: React.SyntheticEvent<HTMLIFrameElement>) => {
    observer.current?.disconnect();
    const body = event.currentTarget.contentDocument?.body;
    if (!body) return;
    const measure = () => {
      const next = Math.ceil(body.getBoundingClientRect().height);
      if (next > 0) setHeight(next + 4);
    };
    observer.current = new ResizeObserver(measure);
    observer.current.observe(body);
    measure();
  };
  return <UiProps ids={{"title":["image.m28100198835a"]}}><iframe title="image.m28100198835a" onLoad={measureOnLoad}
    className="block w-full min-w-0 border-0 bg-transparent" style={{ height, colorScheme: "inherit" }}
    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
    srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'"><meta name="color-scheme" content="light dark"><base target="_blank"></head><body>${html}<style>${suggestionStyles}</style></body></html>`} /></UiProps>;
}

export function GoogleGroundingSources({ grounding }: { grounding?: GoogleGrounding }) {
  if (!grounding) return null;
  const sources = grounding.sources.filter(source => /^https?:\/\//i.test(source.url));
  if (!grounding.renderedContent && !sources.length) return null;
  return <details className="group/grounding nodrag nopan nowheel relative min-w-0 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)]" onPointerDown={event => event.stopPropagation()}>
    <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-xl px-3 py-3 text-xs outline-none transition-colors hover:bg-[var(--panel-3)] focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] [&::-webkit-details-marker]:hidden">
      <Globe2 aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--app-muted)]" />
      <span className="min-w-0 flex-1 font-medium"><UiText id="image.mbbe594d96859" /></span>
      {sources.length > 0 && <span className="shrink-0 text-[11px] tabular-nums text-[var(--app-muted)]">{sources.length}<UiText id="image.m23dafc6812e9" /></span>}
      <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--app-muted)] transition-transform group-open/grounding:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="min-w-0 space-y-3 px-3 pb-3">
      {grounding.renderedContent && <GoogleSearchSuggestions html={grounding.renderedContent} />}
      {sources.length > 0 && <div className="min-w-0 border-t border-[var(--border)] pt-2">
        <div className="mb-1 text-[10px] font-medium tracking-wide text-[var(--app-muted)]"><UiText id="image.m2a3301898d4e" /></div>
        <ul className="m-0 list-none space-y-0.5 p-0">
          {sources.map(source => <li key={source.url} className="min-w-0"><a href={source.url} target="_blank" rel="noopener noreferrer"
            className="group/source flex min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-xs leading-5 text-[var(--app-fg)] no-underline outline-none transition-colors hover:bg-[var(--panel-3)] focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]">
            <Link2 aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 text-[var(--app-muted)]" />
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{source.title}</span>
            <ArrowUpRight aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 text-[var(--app-muted)] group-hover/source:text-[var(--app-fg)]" />
          </a></li>)}
        </ul>
      </div>}
    </div>
  </details>;
}
