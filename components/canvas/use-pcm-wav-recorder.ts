"use client";
import { useUiLocale } from "@/i18n/ui";


import * as React from "react";

import {
  CANVAS_CLONE_MAX_BYTES,
  CANVAS_CLONE_MAX_SECONDS,
  CANVAS_CLONE_SAMPLE_RATE,
  resampleMono,
  encodeMonoPcm16Wav,
} from "@/lib/canvas/pcm-wav";

export type PcmWavRecorderState =
  | "idle"
  | "requesting"
  | "recording"
  | "recorded"
  | "error";

export function usePcmWavRecorder() {
  const { text } = useUiLocale();
  const [state, setState] = React.useState<PcmWavRecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [recordedFile, setRecordedFile] = React.useState<File | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");
  const chunksRef = React.useRef<Float32Array[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const contextRef = React.useRef<AudioContext | null>(null);
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = React.useRef<AudioWorkletNode | null>(null);
  const silenceRef = React.useRef<GainNode | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const startedAtRef = React.useRef(0);
  const stopRef = React.useRef<() => Promise<File | null>>(async () => null);

  const releaseResources = React.useCallback(async () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    workletRef.current?.port.close();
    workletRef.current?.disconnect();
    sourceRef.current?.disconnect();
    silenceRef.current?.disconnect();
    workletRef.current = null;
    sourceRef.current = null;
    silenceRef.current = null;
    for (const track of streamRef.current?.getTracks() || []) track.stop();
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") await context.close();
  }, []);

  const stop = React.useCallback(async () => {
    const context = contextRef.current;
    if (!context) return recordedFile;
    const inputSampleRate = context.sampleRate;
    await releaseResources();
    const samples = resampleMono(
      chunksRef.current,
      inputSampleRate,
      CANVAS_CLONE_SAMPLE_RATE,
    );
    const blob = encodeMonoPcm16Wav(samples, CANVAS_CLONE_SAMPLE_RATE);
    const duration = samples.length / CANVAS_CLONE_SAMPLE_RATE;
    setElapsedSeconds(duration);
    if (blob.size > CANVAS_CLONE_MAX_BYTES) {
      setState("error");
      setErrorMessage(text("workspaceFollowup.m25d5f46374bf"));
      setRecordedFile(null);
      return null;
    }
    const file = new File([blob], "minimax-voice-clone.wav", {
      type: "audio/wav",
    });
    setRecordedFile(file);
    setState("recorded");
    return file;
  }, [recordedFile, releaseResources]);

  React.useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const reset = React.useCallback(() => {
    void releaseResources();
    chunksRef.current = [];
    setState("idle");
    setElapsedSeconds(0);
    setRecordedFile(null);
    setErrorMessage("");
  }, [releaseResources]);

  const start = React.useCallback(async () => {
    await releaseResources();
    chunksRef.current = [];
    setRecordedFile(null);
    setElapsedSeconds(0);
    setErrorMessage("");
    setState("requesting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("当前浏览器不支持麦克风录音");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const context = new AudioContext();
      contextRef.current = context;
      await context.audioWorklet.addModule("/audio/pcm-capture-processor.js");
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "canvas-pcm-capture");
      const silence = context.createGain();
      silence.gain.value = 0;
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        chunksRef.current.push(new Float32Array(event.data));
      };
      source.connect(worklet);
      worklet.connect(silence);
      silence.connect(context.destination);
      sourceRef.current = source;
      workletRef.current = worklet;
      silenceRef.current = silence;
      startedAtRef.current = performance.now();
      setState("recording");
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.min(
          CANVAS_CLONE_MAX_SECONDS,
          (performance.now() - startedAtRef.current) / 1_000,
        );
        setElapsedSeconds(elapsed);
        if (elapsed >= CANVAS_CLONE_MAX_SECONDS) void stopRef.current();
      }, 200);
    } catch (error) {
      await releaseResources();
      setState("error");
      setErrorMessage(
        error instanceof Error ? error.message : text("workspaceFollowup.me2235b4a234a"),
      );
    }
  }, [releaseResources]);

  React.useEffect(
    () => () => {
      void releaseResources();
    },
    [releaseResources],
  );

  return {
    state,
    elapsedSeconds,
    recordedFile,
    errorMessage,
    start,
    stop,
    reset,
  };
}
