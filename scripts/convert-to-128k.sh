#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <input-audio> <output-mp3>"
  exit 1
fi

INPUT_PATH="$1"
OUTPUT_PATH="$2"
OUTPUT_DIR="$(dirname "$OUTPUT_PATH")"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required but was not found in PATH."
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

ffmpeg -y -i "$INPUT_PATH" \
  -vn \
  -ar 44100 \
  -ac 2 \
  -codec:a libmp3lame \
  -b:a 128k \
  "$OUTPUT_PATH"

