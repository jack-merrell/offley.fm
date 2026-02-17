#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import librosa
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
STATIONS_PATH = ROOT / "public" / "media" / "stations.json"


def clamp_bpm(value: float) -> float:
    bpm = float(value)
    while bpm < 75.0:
        bpm *= 2.0
    while bpm > 190.0:
        bpm /= 2.0
    return bpm


def bpm_for_window(track_path: Path, offset_s: float, duration_s: float, sr: int = 22050) -> float | None:
    y, sr = librosa.load(track_path, sr=sr, mono=True, offset=max(0.0, offset_s), duration=duration_s)
    if y.size < sr * 20:
        return None

    _, y_perc = librosa.effects.hpss(y)
    onset_env = librosa.onset.onset_strength(y=y_perc, sr=sr, aggregate=np.median)
    if onset_env.size < 8:
        return None

    tempo_onset = float(librosa.feature.tempo(onset_envelope=onset_env, sr=sr, aggregate=np.median)[0])
    tempo_beat, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, start_bpm=tempo_onset)
    tempo_beat_scalar = float(np.asarray(tempo_beat).item())

    tempo_onset = clamp_bpm(tempo_onset)
    tempo_beat_scalar = clamp_bpm(tempo_beat_scalar)
    return round((tempo_onset + tempo_beat_scalar) * 0.5, 1)


def estimate_bpm(track_path: Path) -> tuple[float | None, float]:
    duration = librosa.get_duration(path=str(track_path))
    if duration <= 0:
        return None, 0.0

    window_s = min(180.0, max(90.0, duration * 0.16))
    offsets = [duration * 0.1, duration * 0.46, duration * 0.78]
    estimates: list[float] = []

    for offset in offsets:
        bpm = bpm_for_window(track_path, offset_s=offset, duration_s=window_s)
        if bpm is not None:
            estimates.append(bpm)

    if not estimates:
        return None, 0.0

    median = float(np.median(np.array(estimates, dtype=float)))
    spread = float(np.max(estimates) - np.min(estimates)) if len(estimates) > 1 else 0.0
    confidence = max(0.0, min(1.0, 1.0 - spread / 18.0))
    return round(median, 1), confidence


def main() -> None:
    payload = json.loads(STATIONS_PATH.read_text(encoding="utf-8"))
    stations: list[dict[str, Any]] = payload.get("stations", [])

    print("Updating station BPM values:", flush=True)
    for station in stations:
        track_value = station.get("track")
        if not isinstance(track_value, str) or not track_value.strip():
            station.pop("bpm", None)
            continue

        if track_value.startswith("/media/"):
            track_path = ROOT / "public" / track_value.lstrip("/")
        else:
            track_path = ROOT / track_value.lstrip("/")
        if not track_path.exists():
            print(f"- {station.get('id', '?')}: track missing ({track_value})", flush=True)
            station.pop("bpm", None)
            continue

        bpm, confidence = estimate_bpm(track_path)
        if bpm is None:
            station.pop("bpm", None)
            print(f"- {station.get('id', '?')}: bpm unavailable", flush=True)
            continue

        station["bpm"] = bpm
        print(f"- {station.get('id', '?')}: {bpm:.1f} BPM (confidence {confidence:.2f})", flush=True)

    STATIONS_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"\nWritten: {STATIONS_PATH}", flush=True)


if __name__ == "__main__":
    main()
