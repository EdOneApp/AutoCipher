#!/usr/bin/env python3
"""Étape 5 — Récupération d'images de fond depuis l'API Pexels (gratuite).

Lit  : <RUN_DIR>/script.json  (champ "mots_cles_images")
Écrit: assets/images/<RUN_ID>_<n>.jpg
       <RUN_DIR>/images.json  ({"images": ["assets/images/..."], "credits": [...]})

Env  : PEXELS_API_KEY (obligatoire)

Pexels autorise l'usage gratuit sans attribution obligatoire, mais on stocke
tout de même le crédit photographe pour pouvoir l'ajouter à la description.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

PEXELS_KEY = os.environ.get("PEXELS_API_KEY", "")
API = "https://api.pexels.com/v1/search"
TARGET = int(os.environ.get("IMAGES_PER_VIDEO", "6"))
# 1080x1920 → orientation portrait pour un Short.
PARAMS_BASE = {"orientation": "portrait", "per_page": 15, "size": "large"}


def search(query: str):
    r = requests.get(
        API,
        headers={"Authorization": PEXELS_KEY},
        params={**PARAMS_BASE, "query": query},
        timeout=30,
    )
    if r.status_code == 429:
        print("[images] 429 Pexels — pause 5s puis nouvel essai")
        time.sleep(5)
        r = requests.get(
            API,
            headers={"Authorization": PEXELS_KEY},
            params={**PARAMS_BASE, "query": query},
            timeout=30,
        )
    r.raise_for_status()
    return r.json().get("photos", [])


def download(url: str, dest: Path) -> bool:
    try:
        with requests.get(url, timeout=60, stream=True) as resp:
            resp.raise_for_status()
            with open(dest, "wb") as fh:
                for chunk in resp.iter_content(chunk_size=1 << 15):
                    fh.write(chunk)
        return dest.stat().st_size > 5000
    except Exception as exc:  # noqa: BLE001
        print(f"[images] échec téléchargement {url} : {exc}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", default=os.environ.get("RUN_DIR", "output"))
    args = parser.parse_args()

    if not PEXELS_KEY:
        print("[images] PEXELS_API_KEY manquante.", file=sys.stderr)
        return 1

    run_dir = Path(args.run_dir)
    run_id = run_dir.name
    script_path = run_dir / "script.json"
    if not script_path.exists():
        print(f"[images] introuvable : {script_path}", file=sys.stderr)
        return 1

    script = json.loads(script_path.read_text(encoding="utf-8"))
    keywords = [k for k in script.get("mots_cles_images", []) if k]
    if not keywords:
        keywords = ["technology", "computer", "data", "software", "office"]

    out_dir = Path("assets/images")
    out_dir.mkdir(parents=True, exist_ok=True)

    images: list[str] = []
    credits: list[dict] = []
    seen_ids: set[int] = set()

    ki = 0
    while len(images) < TARGET and ki < len(keywords) * 3:
        kw = keywords[ki % len(keywords)]
        ki += 1
        try:
            photos = search(kw)
        except Exception as exc:  # noqa: BLE001
            print(f"[images] recherche '{kw}' échouée : {exc}")
            continue
        for photo in photos:
            if len(images) >= TARGET:
                break
            if photo["id"] in seen_ids:
                continue
            seen_ids.add(photo["id"])
            src = photo["src"].get("portrait") or photo["src"].get("large2x")
            if not src:
                continue
            dest = out_dir / f"{run_id}_{len(images)}.jpg"
            if download(src, dest):
                images.append(str(dest).replace("\\", "/"))
                credits.append(
                    {
                        "photographer": photo.get("photographer", ""),
                        "url": photo.get("url", ""),
                        "keyword": kw,
                    }
                )
                print(f"[images] {dest.name}  <-  '{kw}'  ({photo.get('photographer','')})")

    if len(images) < 3:
        print(
            f"[images] seulement {len(images)} image(s) — insuffisant.",
            file=sys.stderr,
        )
        return 1

    (run_dir / "images.json").write_text(
        json.dumps(
            {"images": images, "credits": credits}, ensure_ascii=False, indent=2
        ),
        encoding="utf-8",
    )
    print(f"[images] OK — {len(images)} images")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
