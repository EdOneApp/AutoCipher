#!/usr/bin/env python3
"""Étape 3 — Voix off avec edge-tts (gratuit, aucune clé).

Lit  : <RUN_DIR>/script.json  (champ "script_complet")
Écrit: <RUN_DIR>/voice.mp3
       <RUN_DIR>/voice.json   ({"duration": <secondes>, "voice": ..., "chars": N})

Usage:
    RUN_DIR=output/20260830T120000 python src/generate_voice.py
    python src/generate_voice.py --run-dir output/xxx --voice fr-FR-HenriNeural
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

DEFAULT_VOICE = os.environ.get("TTS_VOICE", "fr-FR-DeniseNeural")
# Léger ralentissement = diction plus posée, meilleure synchro sous-titres.
DEFAULT_RATE = os.environ.get("TTS_RATE", "-4%")
DEFAULT_PITCH = os.environ.get("TTS_PITCH", "+0Hz")


def ffprobe_duration(path: Path) -> float:
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            text=True,
        ).strip()
        return round(float(out), 3)
    except Exception as exc:  # noqa: BLE001
        print(f"[generate_voice] ffprobe indisponible ({exc}) — durée estimée.")
        return 0.0


async def synth(text: str, out_mp3: Path, voice: str) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(
        text, voice=voice, rate=DEFAULT_RATE, pitch=DEFAULT_PITCH
    )
    await communicate.save(str(out_mp3))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", default=os.environ.get("RUN_DIR", "output"))
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    args = parser.parse_args()

    run_dir = Path(args.run_dir)
    script_path = run_dir / "script.json"
    if not script_path.exists():
        print(f"[generate_voice] introuvable : {script_path}", file=sys.stderr)
        return 1

    script = json.loads(script_path.read_text(encoding="utf-8"))
    text = (script.get("script_complet") or "").strip()
    if len(text) < 20:
        print("[generate_voice] script_complet trop court.", file=sys.stderr)
        return 1

    out_mp3 = run_dir / "voice.mp3"
    print(f"[generate_voice] voix={args.voice} rate={DEFAULT_RATE} chars={len(text)}")
    asyncio.run(synth(text, out_mp3, args.voice))

    if not out_mp3.exists() or out_mp3.stat().st_size < 1024:
        print("[generate_voice] fichier audio vide/invalide.", file=sys.stderr)
        return 1

    duration = ffprobe_duration(out_mp3)
    (run_dir / "voice.json").write_text(
        json.dumps(
            {
                "duration": duration,
                "voice": args.voice,
                "rate": DEFAULT_RATE,
                "chars": len(text),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"[generate_voice] OK — {out_mp3} ({duration}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
