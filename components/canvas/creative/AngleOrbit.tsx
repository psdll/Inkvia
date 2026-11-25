"use client";
import { UiProps } from "@/i18n/ui";

import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import type { ImageAngle } from "@/lib/canvas/creative-presets/types";
import { imageAngleFramingScale, normalizeImageAngle } from "@/lib/canvas/creative-presets/angle";
import { buildOrbitCamera, buildOrbitGrid } from "./angle-orbit";
import styles from "./creative.module.css";

export function AngleOrbit({ angle, imageUrl, onChange }: { angle: ImageAngle; imageUrl: string; onChange(angle: ImageAngle): void }) {
  const surface = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ id: number; x: number; y: number; angle: ImageAngle } | null>(null);
  const current = React.useRef({ angle, onChange });
  current.current = { angle, onChange };
  const update = (patch: Partial<ImageAngle>) => onChange(normalizeImageAngle({ ...angle, ...patch }));
  React.useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      const { angle, onChange } = current.current;
      onChange(normalizeImageAngle({ ...angle, zoom: angle.zoom - Math.sign(event.deltaY) * .3 }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const camera = buildOrbitCamera(angle);
  const subjectScale = imageAngleFramingScale(angle);
  const screenScale = subjectScale;
  const orbitGrid = React.useMemo(() => buildOrbitGrid(angle.azimuth, angle.elevation), [angle.azimuth, angle.elevation]);
  const cameraShape = <g data-angle-camera data-depth={camera.depth.toFixed(2)} opacity={camera.depth < 0 ? .65 : 1}>
    {camera.faces.map((face, index) => <polygon key={index} points={face.points} className={face.shade === "lens" ? styles.cameraLens : styles.cameraBody} />)}
    {camera.rearVisible && <g transform={camera.screenTransform}><rect x="-1" y="-1" width="18" height="12" rx="1" className={styles.cameraScreen} />{imageUrl && <svg width="16" height="10" viewBox="0 0 16 10" overflow="hidden"><image data-angle-screen-preview href={imageUrl} x={8 * (1 - screenScale)} y={5 * (1 - screenScale)} width={16 * screenScale} height={10 * screenScale} preserveAspectRatio="xMidYMid slice" /></svg>}</g>}
  </g>;
  return <UiProps ids={{"aria-label":["canvas.mb68b6daeed2e"],"title":["canvas.mdb953d0fcbdc"]}}><div ref={surface} className={styles.orbit} role="group" aria-label="canvas.mb68b6daeed2e" tabIndex={0}
    title="canvas.mdb953d0fcbdc"
    onPointerDown={event => {
      if (event.button !== 0 || (event.target as Element).closest("button")) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, angle };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const start = drag.current; if (!start || start.id !== event.pointerId) return;
      onChange(normalizeImageAngle({ ...start.angle, azimuth: start.angle.azimuth + (event.clientX - start.x) * .75, elevation: start.angle.elevation - (event.clientY - start.y) * .5 }));
    }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      const delta = event.shiftKey ? 15 : 5;
      const patch = event.key === "ArrowLeft" ? { azimuth: angle.azimuth - delta } : event.key === "ArrowRight" ? { azimuth: angle.azimuth + delta }
        : event.key === "ArrowUp" ? { elevation: angle.elevation + delta } : event.key === "ArrowDown" ? { elevation: angle.elevation - delta } : null;
      if (patch) { event.preventDefault(); event.stopPropagation(); update(patch); }
    }}>
    <UiProps ids={{"aria-label":["canvas.m5efe7ef4b0d2"]}}><svg viewBox="0 0 240 240" role="img" aria-label="canvas.m5efe7ef4b0d2">
      <path d={orbitGrid.back} className={styles.orbitBack} /><path d={orbitGrid.front} className={styles.orbitFront} />
      {camera.depth < 0 && cameraShape}
      <g data-angle-subject transform={`translate(120 120) scale(${subjectScale}) translate(-120 -120)`}>
        {imageUrl && <image href={imageUrl} x="90" y="89" width="60" height="62" preserveAspectRatio="xMidYMid meet" />}
      </g>
      <g data-angle-sightline>
        <line x1={camera.lens.x} y1={camera.lens.y} x2="120" y2="120" className={styles.cameraLine} />
      </g>
      {camera.depth >= 0 && cameraShape}
    </svg></UiProps>
    {([{ label: "向左环绕", Icon: ChevronLeft, position: "left", patch: { azimuth: angle.azimuth - 45 } },
      { label: "向右环绕", Icon: ChevronRight, position: "right", patch: { azimuth: angle.azimuth + 45 } },
      { label: "抬高机位", Icon: ChevronUp, position: "up", patch: { elevation: angle.elevation + 30 } },
      { label: "降低机位", Icon: ChevronDown, position: "down", patch: { elevation: angle.elevation - 30 } }] as const).map(({ label, Icon, position, patch }) =>
      <button key={position} type="button" className={styles.orbitArrow} data-direction={position} aria-label={label} title={label} disabled={position === "up" ? angle.elevation >= 90 : position === "down" ? angle.elevation <= -90 : false} onClick={() => update(patch)}><Icon size={14} /></button>)}
  </div></UiProps>;
}
