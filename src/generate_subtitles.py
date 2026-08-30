#!/usr/bin/env python3
"""Étape 4 — Sous-titres synchronisés mot par mot avec Whisper (local, gratuit).

Lit  : <RUN_DIR>/voice.mp3
Écrit: <RUN_DIR>/subtitles.json
       {
         "words":  [{"text": "Bonjour", "start": 0.12, "end": 0.44}, ...],
         "phrases":[{"text": "...", "start": ..., "end": ...}, ...],
         "duration": <float>,
         "model": "base",
         "language": "fr"
       }

Modèle par défaut : WHISPER_MODEL (env) ou "base".
Utilise openai-whisper. Pour un CI plus rapide, remplacer par faster-whisper
(voir README) — le format de sortie ci-dessus doit être conservé.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def group_phrases(words, max_chars=42, max_gap=0.6):
    """Regroupe les mots en courtes lignes de sous-titres."""
    phrases = []
    cur = []
    cur_len = 0
    for w in words:
        gap = w["start"] - cur[-1]["end"] if cur else 0
        if cur and (cur_len + len(w["text"]) + 1 > max_chars or gap > max_gap):
            phrases.append(
                {
                    "text": " ".join(x["text"] for x in cur),
                    "start": cur[0]["start"],
                    "end": cur[-1]["end"],
                }
            )
            cur, cur_len = [], 0
        cur.append(w)
        cur_len += len(w["text"]) + 1
    if cur:
        phrases.append(
            {
                "text": " ".join(x["text"] for x in cur),
                "start": cur[0]["start"],
                "end": cur[-1]["end"],
            }
        )
    return phrases


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", default=os.environ.get("RUN_DIR", "output"))
    parser.add_argument(
        "--model", default=os.environ.get("WHISPER_MODEL", "base")
    )
    args = parser.parse_args()

    run_dir = Path(args.run_dir)
    audio = run_dir / "voice.mp3"
    if not audio.exists():
        print(f"[subtitles] introuvable : {audio}", file=sys.stderr)
        return 1

    import whisper

    print(f"[subtitles] chargement du modèle Whisper '{args.model}'...")
    model = whisper.load_model(args.model)

    print("[subtitles] transcription (word_timestamps=True)...")
    result = model.transcribe(
        str(audio),
        language="fr",
        word_timestamps=True,
        fp16=False,
        verbose=False,
    )

    words = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            txt = (w.get("word") or "").strip()
            if not txt:
                continue
            words.append(
                {
                    "text": txt,
                    "start": round(float(w["start"]), 3),
                    "end": round(float(w["end"]), 3),
                }
            )

    if not words:
        print("[subtitles] aucun mot horodaté obtenu.", file=sys.stderr)
        return 1

    duration = words[-1]["end"]
    payload = {
        "words": words,
        "phrases": group_phrases(words),
        "duration": duration,
        "model": args.model,
        "language": result.get("language", "fr"),
        "text": result.get("text", "").strip(),
    }
    (run_dir / "subtitles.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"[subtitles] OK — {len(words)} mots, "
        f"{len(payload['phrases'])} lignes, {duration}s"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
