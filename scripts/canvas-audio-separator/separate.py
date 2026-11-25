"""Local two-stem inference. Input/output paths are supplied only by our server."""
import argparse
import os
import subprocess
import wave

import imageio_ffmpeg
import numpy as np
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--stem", choices=["vocals", "background"])
    parser.add_argument("--warmup", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    model = get_model("htdemucs").cpu().eval()
    if args.warmup:
        print("htdemucs ready", flush=True)
        return
    if not args.input or not args.output or not args.stem:
        parser.error("--input, --output and --stem are required")
    # Bound decoding to five minutes, plus one second to detect oversized inputs.
    decoded = subprocess.run([
        imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-v", "error",
        "-protocol_whitelist", "file,pipe", "-f", "mov", "-i", args.input, "-t", "301",
        "-vn", "-ac", "2", "-ar", "44100", "-f", "f32le", "pipe:1",
    ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120).stdout
    samples = np.frombuffer(decoded, dtype=np.float32).reshape(-1, 2).T.copy()
    if samples.shape[1] == 0 or samples.shape[1] > 300 * 44100:
        raise ValueError("Audio must be between 0 and 300 seconds")
    audio = torch.from_numpy(samples)
    reference = audio.mean(0)
    mean, std = reference.mean(), reference.std().clamp_min(1e-8)
    with torch.inference_mode():
        stems = apply_model(model, ((audio - mean) / std)[None], device="cpu",
                            shifts=0, split=True, overlap=0.25, progress=False)[0]
    stems = stems * std + mean
    vocal_index = model.sources.index("vocals")
    result = stems[vocal_index] if args.stem == "vocals" else stems[
        [i for i in range(len(model.sources)) if i != vocal_index]
    ].sum(0)
    # Only rescale if needed to prevent clipping, preserving relative dynamics.
    result = result / max(1.0, result.abs().max().item() / 0.99)
    pcm = (result.T.contiguous().numpy() * 32767).astype("<i2")
    with wave.open(args.output, "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(44100)
        output.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main()
