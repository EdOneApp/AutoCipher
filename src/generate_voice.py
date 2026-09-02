#!/usr/bin/env python3
"""Étape 3 — Voix off avec edge-tts (gratuit, aucune clé).

Lit  : <RUN_DIR>/script.json  (champ "script_complet")
Écrit: <RUN_DIR>/voice.mp3
       <RUN_DIR>/voice.json   ({"duration": <secondes>, "voice": ..., "chars": N})

La voix CHANGE à chaque run : elle est tirée au sort dans VOICE_POOL en évitant
les 3 dernières utilisées (état persistant dans src/db/voice.json, committé par
le workflow). Forcer une voix : --voice fr-FR-HenriNeural  ou  env TTS_VOICE.

Usage:
    RUN_DIR=output/20260830T120000 python src/generate_voice.py
    python src/generate_voice.py --run-dir output/xxx --voice fr-FR-HenriNeural
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import subprocess
import sys
from pathlib import Path

# Voix off françaises edge-tts, hommes et femmes, plusieurs accents (FR, BE, CH).
# Surchargeable via TTS_VOICE_POOL="voixA,voixB,...".
DEFAULT_VOICE_POOL = [
    "fr-FR-DeniseNeural",
    "fr-FR-HenriNeural",
    "fr-FR-EloiseNeural",
    "fr-FR-RemyMultilingualNeural",
    "fr-FR-VivienneMultilingualNeural",
    "fr-BE-CharlineNeural",
    "fr-BE-GerardNeural",
    "fr-CH-ArianeNeural",
    "fr-CH-FabriceNeural",
]
VOICE_POOL = [
    v.strip()
    for v in os.environ.get("TTS_VOICE_POOL", ",".join(DEFAULT_VOICE_POOL)).split(",")
    if v.strip()
] or DEFAULT_VOICE_POOL

# Chemin de l'état de rotation (relatif à la racine du repo = cwd du pipeline).
VOICE_STATE_PATH = Path(os.environ.get("TTS_VOICE_STATE", "src/db/voice.json"))
# On évite de réutiliser une voix vue dans les N derniers runs.
VOICE_AVOID_LAST = int(os.environ.get("TTS_VOICE_AVOID_LAST", "3"))

# Voix forcée éventuelle (sinon rotation). --voice a la priorité sur l'env.
FORCED_VOICE = os.environ.get("TTS_VOICE", "").strip()
# Léger ralentissement = diction plus posée, meilleure synchro sous-titres.
DEFAULT_RATE = os.environ.get("TTS_RATE", "-4%")
DEFAULT_PITCH = os.environ.get("TTS_PITCH", "+0Hz")


def pick_rotating_voice() -> str:
    """Tire une voix du pool en évitant les VOICE_AVOID_LAST dernières."""
    state = {"recent": []}
    try:
        if VOICE_STATE_PATH.exists():
            state = json.loads(VOICE_STATE_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"[generate_voice] état voix illisible ({exc}) — on repart de zéro.")

    recent = [v for v in state.get("recent", []) if v in VOICE_POOL]
    avoid = set(recent[-VOICE_AVOID_LAST:])
    choices = [v for v in VOICE_POOL if v not in avoid] or VOICE_POOL
    voice = random.choice(choices)

    recent.append(voice)
    recent = recent[-max(VOICE_AVOID_LAST * 3, 12):]
    try:
        VOICE_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        VOICE_STATE_PATH.write_text(
            json.dumps(
                {
                    "last": voice,
                    "recent": recent,
                    "pool_size": len(VOICE_POOL),
                    "updatedAt": _now_iso(),
                    "_comment": (
                        "Rotation des voix off edge-tts. `recent` = voix des "
                        "derniers runs, évitées au prochain tirage. Géré par "
                        "src/generate_voice.py, committé par le workflow."
                    ),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[generate_voice] impossible d'écrire {VOICE_STATE_PATH} ({exc}).")
    return voice


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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
    parser.add_argument(
        "--voice",
        default=None,
        help="Force une voix précise. Sinon : env TTS_VOICE, sinon rotation.",
    )
    args = parser.parse_args()

    # Priorité : --voice > env TTS_VOICE > rotation dans le pool.
    if args.voice:
        voice = args.voice
        print(f"[generate_voice] voix forcée (--voice) : {voice}")
    elif FORCED_VOICE:
        voice = FORCED_VOICE
        print(f"[generate_voice] voix forcée (TTS_VOICE) : {voice}")
    else:
        voice = pick_rotating_voice()
        print(f"[generate_voice] voix tirée au sort : {voice} (pool {len(VOICE_POOL)})")
    args.voice = voice

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
