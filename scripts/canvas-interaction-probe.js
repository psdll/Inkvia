/* Evaluate this function through the connected browser's developer API.
 * It only observes the current page for a bounded interval. No network, storage,
 * synthetic input, node movement, or global instrumentation survives completion.
 */
async function observeCanvasInteraction(durationMs = 10000) {
  const pane = document.querySelector(".react-flow");
  const viewport = pane?.querySelector(".react-flow__viewport");
  if (!pane || !viewport) throw new Error("Canvas is not mounted");
  const duration = Math.max(1000, Math.min(30000, durationMs || 10000));
  const start = performance.now();
  const stamp = () => performance.now() - start;
  const frames = [], inputs = [], changes = [], tasks = [], visibility = [], media = [];
  const videos = new Map();
  const listeners = [];
  let frame = 0, timer = 0, inputOverflow = 0, changeOverflow = 0;
  const positions = () => [...pane.querySelectorAll(".react-flow__node")].map(node => ({
    id: node.getAttribute("data-id"), transform: node.style.transform,
    selected: node.classList.contains("selected"),
  }));
  const before = { camera: viewport.style.transform, nodes: positions(), edges: pane.querySelectorAll(".react-flow__edge").length };
  const listen = (type, handler) => {
    document.addEventListener(type, handler, true);
    listeners.push(() => document.removeEventListener(type, handler, true));
  };
  const quality = video => {
    const q = video.getVideoPlaybackQuality?.();
    return { t: stamp(), time: video.currentTime, paused: video.paused,
      readyState: video.readyState, total: q?.totalVideoFrames ?? null, dropped: q?.droppedVideoFrames ?? null };
  };
  const videoRecord = video => {
    if (!videos.has(video)) {
      const record = { id: media.length, node: video.closest(".react-flow__node")?.getAttribute("data-id"),
        initial: quality(video), events: [], stable: null, final: null, playingAt: video.paused ? null : stamp() };
      videos.set(video, record); media.push(record);
    }
    return videos.get(video);
  };
  const sampleVideos = () => {
    pane.querySelectorAll("video").forEach(videoRecord);
    for (const [video, record] of videos) {
      record.final = quality(video);
      // Keep a separate baseline after uninterrupted playback has warmed up.
      if (!record.stable && record.playingAt !== null && !video.paused && stamp() - record.playingAt >= 1000) record.stable = quality(video);
    }
  };
  let longTasks;
  const observer = new MutationObserver(records => {
    if (changes.length >= 5000) { changeOverflow += records.length; return; }
    changes.push({ t: stamp(), camera: viewport.style.transform,
      nodeIds: [...new Set(records.map(r => r.target.closest?.(".react-flow__node")?.getAttribute("data-id")).filter(Boolean))] });
  });
  try {
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "keydown"]) listen(type, event => {
      if (!pane.contains(event.target)) return;
      if (inputs.length >= 5000) { inputOverflow++; return; }
      inputs.push({ t: stamp(), type, trusted: event.isTrusted, x: event.clientX, y: event.clientY,
        buttons: event.buttons, dx: event.deltaX, dy: event.deltaY, ctrl: event.ctrlKey, shift: event.shiftKey,
        node: event.target.closest?.(".react-flow__node")?.getAttribute("data-id") });
    });
    for (const type of ["loadstart", "loadedmetadata", "loadeddata", "playing", "waiting", "stalled", "pause", "ended", "error"]) listen(type, event => {
      if (!(event.target instanceof HTMLVideoElement) || !pane.contains(event.target)) return;
      const record = videoRecord(event.target);
      if (type === "playing") record.playingAt = stamp();
      if (["waiting", "pause", "ended"].includes(type)) record.playingAt = null;
      record.events.push({ type, ...quality(event.target) });
    });
    const visible = () => visibility.push({ t: stamp(), state: document.visibilityState, focus: document.hasFocus() });
    listen("visibilitychange", visible); visible();
    observer.observe(viewport, { subtree: true, attributes: true, attributeFilter: ["style"] });
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      longTasks = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => ({ t: e.startTime - start, duration: e.duration }))));
      longTasks.observe({ type: "longtask" });
    }
    const tick = () => { frames.push(stamp()); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    sampleVideos(); timer = setInterval(sampleVideos, 250);
    await new Promise(resolve => setTimeout(resolve, duration));
    sampleVideos(); visible();
  } finally {
    cancelAnimationFrame(frame); clearInterval(timer); observer.disconnect(); longTasks?.disconnect();
    listeners.forEach(remove => remove());
  }
  return {
    method: "Passive page observation; rAF callback intervals are not presented FPS or physical input latency",
    duration: stamp(), before, after: { camera: viewport.style.transform, nodes: positions() },
    frames, inputs, changes, tasks, visibility, media, inputOverflow, changeOverflow,
  };
}
