"use client";

import * as React from "react";
import {
  createCanvasAudioPlaybackController,
  type CanvasAudioPlaybackController,
} from "@/lib/canvas/audio-playback";

const CanvasAudioPlaybackContext = React.createContext<CanvasAudioPlaybackController | null>(null);

export function CanvasAudioPlaybackProvider({ nodeIds, children }: { nodeIds: string[]; children: React.ReactNode }) {
  const [controller] = React.useState(() => createCanvasAudioPlaybackController());
  const audioRef = React.useCallback((audio: HTMLAudioElement | null) => controller.attach(audio), [controller]);

  React.useEffect(() => {
    controller.retainNodes(new Set(nodeIds));
  }, [controller, nodeIds]);

  React.useEffect(() => () => {
    controller.stop();
  }, [controller]);

  return (
    <CanvasAudioPlaybackContext.Provider value={controller}>
      {children}
      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        onPlay={() => controller.syncFromTarget()}
        onPause={() => controller.syncFromTarget()}
        onTimeUpdate={() => controller.syncFromTarget()}
        onDurationChange={() => controller.syncFromTarget()}
        onEnded={() => controller.ended()}
        onError={() => controller.fail()}
      />
    </CanvasAudioPlaybackContext.Provider>
  );
}

export function useCanvasAudioPlayback(nodeId: string) {
  const controller = React.useContext(CanvasAudioPlaybackContext);
  if (!controller) throw new Error("CanvasAudioPlaybackProvider is missing");
  const subscribe = React.useCallback((listener: () => void) => controller.subscribe(nodeId, listener), [controller, nodeId]);
  const getSnapshot = React.useCallback(() => controller.snapshot(nodeId), [controller, nodeId]);
  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    snapshot,
    stop: React.useCallback(() => { if (controller.snapshot(nodeId).active) controller.stop(); }, [controller, nodeId]),
    toggle: React.useCallback((url: string, durationSeconds = 0) => controller.toggle(nodeId, url, durationSeconds), [controller, nodeId]),
    seek: React.useCallback((url: string, seconds: number, durationSeconds = 0) => controller.seek(nodeId, url, seconds, durationSeconds), [controller, nodeId]),
  };
}
