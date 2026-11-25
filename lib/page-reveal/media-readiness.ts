type PageMediaWaitOptions = {
  timeoutMs?: number;
  settleFrames?: number;
  quietMs?: number;
};

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(resolve, 16);
  });
}

export function isElementInRevealViewport(element: Element) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return (
    rect.bottom > 0
    && rect.right > 0
    && rect.top < window.innerHeight
    && rect.left < window.innerWidth
  );
}

function waitForMediaEvent(
  element: Element,
  successEvent: string,
  signal: AbortSignal,
) {
  return new Promise<"success" | "error" | "aborted">((resolve) => {
    const settle = (result: "success" | "error" | "aborted") => {
      element.removeEventListener(successEvent, onSuccess);
      element.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onSuccess = () => settle("success");
    const onError = () => settle("error");
    const onAbort = () => settle("aborted");
    element.addEventListener(successEvent, onSuccess, { once: true });
    element.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function decodeLoadedImage(image: HTMLImageElement) {
  if (image.naturalWidth <= 0) return;
  if (typeof image.decode !== "function") return;
  await image.decode().catch(() => undefined);
}

async function waitForImage(image: HTMLImageElement, signal: AbortSignal) {
  if (!image.complete) {
    const result = await waitForMediaEvent(image, "load", signal);
    if (result !== "success") return;
  }
  await decodeLoadedImage(image);
}

async function waitForPoster(posterUrl: string, signal: AbortSignal) {
  const poster = new Image();
  poster.src = posterUrl;
  await waitForImage(poster, signal);
}

async function waitForVideo(video: HTMLVideoElement, signal: AbortSignal) {
  const posterUrl = String(video.poster || "").trim();
  const hasPlaybackSource = Boolean(
    String(video.currentSrc || video.src || "").trim()
    || video.querySelector("source[src]"),
  );
  const readiness: Promise<unknown>[] = [];
  if (posterUrl) readiness.push(waitForPoster(posterUrl, signal));
  if (hasPlaybackSource && video.readyState < HTMLMediaElement.HAVE_METADATA) {
    readiness.push(waitForMediaEvent(video, "loadedmetadata", signal));
  }
  await Promise.all(readiness);
}

function visibleMedia(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img, video"))
    .filter(isElementInRevealViewport);
}

function mediaSignature(element: HTMLImageElement | HTMLVideoElement) {
  if (element instanceof HTMLVideoElement) {
    const sourceUrls = Array.from(element.querySelectorAll<HTMLSourceElement>("source[src]"))
      .map((source) => source.src)
      .join("|");
    return `video:${element.poster}|${element.currentSrc || element.src}|${sourceUrls}`;
  }
  return `image:${element.currentSrc || element.src}|${element.srcset}`;
}

function mutationChangesMedia(mutation: MutationRecord) {
  if (mutation.type === "attributes") {
    return mutation.target instanceof HTMLImageElement
      || mutation.target instanceof HTMLVideoElement
      || mutation.target instanceof HTMLSourceElement;
  }
  return Array.from(mutation.addedNodes).some((node) =>
    node instanceof Element
    && (
      node.matches("img, video, source")
      || Boolean(node.querySelector("img, video, source"))
    ),
  );
}

export async function waitForPageMedia(
  root: HTMLElement,
  options: PageMediaWaitOptions = {},
) {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 8000);
  const settleFrames = Math.max(0, options.settleFrames ?? 2);
  const quietMs = Math.max(0, options.quietMs ?? 120);
  for (let frame = 0; frame < settleFrames; frame += 1) {
    await nextAnimationFrame();
  }

  const controller = new AbortController();
  let timeoutId: number | null = null;
  const mediaReady = (async () => {
    const settledSignatures = new WeakMap<Element, string>();
    let lastMutationAt = Date.now();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some(mutationChangesMedia)) lastMutationAt = Date.now();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "poster"],
    });
    try {
      while (!controller.signal.aborted) {
        const pending = visibleMedia(root).filter(
          (element) => settledSignatures.get(element) !== mediaSignature(element),
        );
        if (pending.length) {
          pending.forEach((element) => settledSignatures.set(element, mediaSignature(element)));
          await Promise.all(pending.map((element) =>
            element instanceof HTMLVideoElement
              ? waitForVideo(element, controller.signal)
              : waitForImage(element, controller.signal),
          ));
          lastMutationAt = Date.now();
          continue;
        }
        if (Date.now() - lastMutationAt >= quietMs) {
          await nextAnimationFrame();
          const lateMedia = visibleMedia(root).some(
            (element) => settledSignatures.get(element) !== mediaSignature(element),
          );
          if (!lateMedia && Date.now() - lastMutationAt >= quietMs) break;
          continue;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
      }
    } finally {
      observer.disconnect();
    }
    return { timedOut: false as const };
  })();
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timeoutId = window.setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });

  const result = await Promise.race([mediaReady, timeout]);
  if (timeoutId !== null) window.clearTimeout(timeoutId);
  controller.abort();
  return result;
}
