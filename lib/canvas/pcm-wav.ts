export const CANVAS_CLONE_SAMPLE_RATE = 24_000;
export const CANVAS_CLONE_MIN_SECONDS = 10;
export const CANVAS_CLONE_MAX_SECONDS = 300;
export const CANVAS_CLONE_MAX_BYTES = 20 * 1024 * 1024;

function assertRate(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}无效`);
  }
}

export function resampleMono(
  chunks: Float32Array[],
  inputSampleRate: number,
  outputSampleRate = CANVAS_CLONE_SAMPLE_RATE,
) {
  assertRate(inputSampleRate, "输入采样率");
  assertRate(outputSampleRate, "输出采样率");
  const inputLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const input = new Float32Array(inputLength);
  let offset = 0;
  for (const chunk of chunks) {
    input.set(chunk, offset);
    offset += chunk.length;
  }
  if (outputSampleRate === inputSampleRate) return input;

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  if (outputSampleRate > inputSampleRate) {
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const position = outputIndex * ratio;
      const left = Math.floor(position);
      const right = Math.min(left + 1, input.length - 1);
      output[outputIndex] =
        input[left] + (input[right] - input[left]) * (position - left);
    }
    return output;
  }
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.max(start + 1, Math.floor((outputIndex + 1) * ratio));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      sum += input[inputIndex] || 0;
    }
    output[outputIndex] = sum / (end - start);
  }
  return output;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export function encodeMonoPcm16Wav(
  samples: Float32Array,
  sampleRate = CANVAS_CLONE_SAMPLE_RATE,
) {
  assertRate(sampleRate, "采样率");
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] || 0));
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(44 + index * bytesPerSample, Math.round(pcm), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return new TextDecoder().decode(bytes.slice(offset, offset + length));
}

export function inspectPcmWav(buffer: ArrayBuffer) {
  if (buffer.byteLength < 44) throw new Error("WAV 文件头无效");
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WAVE" ||
    ascii(bytes, 12, 4) !== "fmt " ||
    ascii(bytes, 36, 4) !== "data"
  ) {
    throw new Error("WAV 文件结构无效");
  }
  const audioFormat = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataBytes = view.getUint32(40, true);
  if (
    audioFormat !== 1 ||
    channels !== 1 ||
    sampleRate !== CANVAS_CLONE_SAMPLE_RATE ||
    bitsPerSample !== 16 ||
    44 + dataBytes > buffer.byteLength
  ) {
    throw new Error("WAV 必须为 24kHz 单声道 16-bit PCM");
  }
  return {
    channels,
    sampleRate,
    bitsPerSample,
    durationSeconds: dataBytes / (sampleRate * channels * (bitsPerSample / 8)),
  };
}
