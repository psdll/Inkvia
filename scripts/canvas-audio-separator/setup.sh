#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
separator_root="$PWD/.runtime-local/audio-separation"
"${PYTHON:-python3}" -m venv "$separator_root/venv"
"$separator_root/venv/bin/python" -m pip install -r scripts/canvas-audio-separator/requirements.txt
TORCH_HOME="$separator_root/models" "$separator_root/venv/bin/python" scripts/canvas-audio-separator/separate.py --warmup
