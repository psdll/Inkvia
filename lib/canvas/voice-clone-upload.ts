import {
  CANVAS_CLONE_MAX_BYTES,
  CANVAS_CLONE_MAX_SECONDS,
  CANVAS_CLONE_MIN_SECONDS,
  CANVAS_CLONE_SAMPLE_RATE,
  encodeMonoPcm16Wav,
  resampleMono,
} from "./pcm-wav";

export async function prepareVoiceCloneUpload(file: File) {
  if (!/\.(mp3|m4a|wav)$/i.test(file.name)) {
    throw new Error("请选择 MP3、M4A 或 WAV 音频文件");
  }
  if (!file.size) throw new Error("音频文件为空，请重新选择");
  if (file.size > CANVAS_CLONE_MAX_BYTES) throw new Error("音频文件不能超过 20 MB");
  const AudioContextClass = globalThis.AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器不支持音频文件解析");
  const context = new AudioContextClass();
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer()).catch(() => {
      throw new Error("无法读取音频，请确认文件未损坏，或改用 MP3、WAV 文件");
    });
    if (
      !Number.isFinite(audio.duration) ||
      audio.duration < CANVAS_CLONE_MIN_SECONDS ||
      audio.duration > CANVAS_CLONE_MAX_SECONDS
    ) {
      throw new Error(Number.isFinite(audio.duration)
        ? `音频时长为 ${audio.duration.toFixed(2)} 秒，需为 10 秒到 5 分钟，请更换音频`
        : "无法读取音频时长，请选择 10 秒到 5 分钟的音频");
    }
    const mono = new Float32Array(audio.length);
    for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
      const samples = audio.getChannelData(channel);
      for (let index = 0; index < mono.length; index += 1) {
        mono[index] += samples[index] / audio.numberOfChannels;
      }
    }
    const samples = resampleMono([mono], audio.sampleRate);
    const blob = encodeMonoPcm16Wav(samples);
    return {
      file: new File([blob], file.name.replace(/\.(mp3|m4a|wav)$/i, ".wav"), { type: "audio/wav" }),
      durationSeconds: samples.length / CANVAS_CLONE_SAMPLE_RATE,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}
