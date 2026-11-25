// Rendering shared by every canvas task generation placeholder.
const stars = Array.from({ length: 60 }, (_, i) => ({
  x: 0.035 + ((i * 0.61803398875) % 0.93),
  y: 0.035 + ((i * 0.37917317) % 0.93),
  r: i % 7 === 0 ? 1.05 : 0.55,
  phase: i * 2.39996,
  speed: 0.9 + (i % 9) * 0.11,
}));
const dust = Array.from({ length: 150 }, (_, i) => ({
  x: (i * 0.754877666) % 1,
  y: (i * 0.569840296) % 1,
  phase: i * 1.713,
  size: i % 4 === 0 ? 0.65 : 0.38,
}));

export function drawCanvasGenerationEffect(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsed: number,
) {
  if (w <= 0 || h <= 0) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const phase = (elapsed % 4000) / 4000;
  const progress = Math.min(phase / 0.79, 1);
  const tail = w * 1.1;
  const front = progress * (w * 1.45 + tail);
  const fade = Math.min(1, progress * 14, (1 - progress) * 9);
  const glow = ctx.createLinearGradient(front - tail, 0, front + w * 0.08, 0);
  const alpha = 0.2 * fade;
  [
    [0, 0],
    [0.14, 0.1],
    [0.3, 0.38],
    [0.48, 0.73],
    [0.63, 0.97],
    [0.74, 1],
    [0.84, 0.84],
    [0.94, 0.26],
    [1, 0],
  ].forEach(([stop, a]) =>
    glow.addColorStop(stop, `rgba(235,240,250,${a * alpha})`),
  );
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  {
    // A soft second reflection gives the broad light face depth without a hard scan line.
    const crest = front - tail * 0.24;
    const reflection = ctx.createLinearGradient(
      crest - w * 0.25,
      0,
      crest + w * 0.2,
      0,
    );
    [
      [0, 0],
      [0.25, 0.018],
      [0.48, 0.06],
      [0.64, 0.105],
      [0.79, 0.04],
      [1, 0],
    ].forEach(([stop, a]) =>
      reflection.addColorStop(stop, `rgba(243,247,255,${a * fade})`),
    );
    ctx.fillStyle = reflection;
    ctx.fillRect(0, 0, w, h);
    // Edge falloff keeps the center luminous while retaining the full-height sweep.
    const depth = ctx.createLinearGradient(0, 0, 0, h);
    depth.addColorStop(0, "rgba(0,0,0,.16)");
    depth.addColorStop(0.38, "rgba(0,0,0,0)");
    depth.addColorStop(0.72, "rgba(0,0,0,.04)");
    depth.addColorStop(1, "rgba(0,0,0,.22)");
    ctx.fillStyle = depth;
    ctx.fillRect(0, 0, w, h);
    // Only the part of the rim crossed by the light reflects it.
    const rim = ctx.createLinearGradient(
      crest - w * 0.28,
      0,
      crest + w * 0.22,
      0,
    );
    rim.addColorStop(0, "rgba(228,238,255,0)");
    rim.addColorStop(0.56, `rgba(228,238,255,${0.28 * fade})`);
    rim.addColorStop(1, "rgba(228,238,255,0)");
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, w, 1);
    ctx.fillRect(0, h - 1, w, 1);
  }
  {
    // Broad satin reflections move inside the existing light face.
    const center = front - tail * 0.38;
    for (let y = 0; y < h; y += 3) {
      const flow = Math.sin((y / h) * 4.2 - elapsed * 0.00065);
      const offset = flow * w * 0.035;
      const sheen = ctx.createLinearGradient(
        center - w * 0.3 + offset,
        0,
        center + w * 0.32 + offset,
        0,
      );
      const energy =
        (0.057 + 0.022 * Math.cos((y / h) * 5.1 + elapsed * 0.0008)) * fade;
      sheen.addColorStop(0, "rgba(225,235,255,0)");
      sheen.addColorStop(0.3, `rgba(225,235,255,${energy * 0.4})`);
      sheen.addColorStop(0.58, `rgba(245,248,255,${energy})`);
      sheen.addColorStop(0.84, `rgba(225,235,255,${energy * 0.3})`);
      sheen.addColorStop(1, "rgba(225,235,255,0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(0, y, w, 3);
    }
    dust.forEach((d) => {
      const x = d.x * w,
        y = d.y * h;
      const lit =
        Math.exp(-Math.pow((x - (front - tail * 0.29)) / (w * 0.24), 2)) * fade;
      const sparkle =
        0.3 + 0.7 * Math.pow((Math.sin(elapsed * 0.0018 + d.phase) + 1) / 2, 3);
      ctx.fillStyle = `rgba(225,236,255,${lit * sparkle * 0.38})`;
      ctx.beginPath();
      ctx.arc(x, y, d.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  stars.forEach((s, i) => {
    const x = s.x * w,
      y = s.y * h;
    const center = front - tail * 0.22;
    const behind = center - x;
    const response =
      behind >= 0
        ? Math.exp(-behind / (w * 0.32))
        : Math.exp(-Math.pow(behind / (w * 0.08), 2));
    const wave = Math.pow(
      (Math.sin(elapsed * 0.001 * s.speed + s.phase) + 1) / 2,
      5,
    );
    const a = Math.min(1, 0.13 + wave * 0.46 + response * 0.8 * fade);
    if (i % 5 === 0) {
      const radius = 5 + response * 4;
      const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const strength = response * fade * (0.06 + wave * 0.06);
      halo.addColorStop(0, `rgba(231,240,255,${strength})`);
      halo.addColorStop(0.3, `rgba(218,234,255,${strength * 0.4})`);
      halo.addColorStop(1, "rgba(218,234,255,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.fillStyle = `rgba(237,243,255,${a})`;
    ctx.shadowColor = `rgba(202,222,255,${a * 0.65})`;
    ctx.shadowBlur = 3 + response * 5;
    ctx.beginPath();
    ctx.arc(x, y, s.r * (1 + response * 0.2), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (i % 8 === 0) {
      const glint = wave * 0.3 + response * 0.75 * fade;
      ctx.strokeStyle = `rgba(233,242,255,${glint * 0.7})`;
      ctx.lineWidth = 0.6;
      const len = 2 + glint * 3.3;
      ctx.beginPath();
      ctx.moveTo(x - len, y);
      ctx.lineTo(x + len, y);
      ctx.moveTo(x, y - len);
      ctx.lineTo(x, y + len);
      ctx.stroke();
    }
  });
}
