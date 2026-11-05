#!/usr/bin/env python3
"""Stage the Air Hockey Toy upload package with platform-safe .js modules.

Bilibili Toy preview/CDN currently serves the package's JavaScript modules as
`.js`; the source and native shells keep `.mjs`. This staging step preserves
the same bytes and relative import graph while changing only that extension.
"""
import hashlib
import json
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT / "web" / "air-hockey"
if not SOURCE.is_dir():
    SOURCE = PROJECT
FILES = [
    "index.html", "styles.css", "game.mjs", "combo.mjs", "physics.mjs",
    "platform.mjs", "leaderboard.mjs", "competition-client.mjs", "online.mjs", "online-config.mjs",
    "sfx.mjs", "haptics.mjs", "icon.svg",
    "promo/index.html", "promo/film.html", "promo/player.mjs", "promo/promo.mjs",
    "promo/timeline.mjs", "promo/rally.mjs", "promo/scene.mjs",
    "promo/camera3d.mjs", "promo/overlay.mjs", "promo/audio.mjs",
    "promo/toy.mjs", "promo/toycard.mjs", "promo/dist/air-hockey-collision-promo.mp4",
    "promo/assets/voiceover-toy.wav",
]


def target_name(relative: str) -> str:
    path = Path(relative)
    return str(path.with_suffix(".js")) if path.suffix == ".mjs" else relative


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {Path(sys.argv[0]).name} <empty-target-dir>")
    target = Path(sys.argv[1])
    target.mkdir(parents=True, exist_ok=True)
    if any(target.iterdir()):
        raise SystemExit("staging directory must be empty")
    manifest = {}
    for relative in FILES:
        origin = SOURCE / relative
        if origin.is_symlink() or not origin.is_file():
            raise SystemExit(f"missing or symbolic runtime asset: {relative}")
        output = target / target_name(relative)
        output.parent.mkdir(parents=True, exist_ok=True)
        data = origin.read_bytes()
        if origin.suffix in {".mjs", ".html"}:
            data = data.replace(b".mjs", b".js")
        output.write_bytes(data)
        manifest[target_name(relative)] = hashlib.sha256(data).hexdigest()
    (target / "ASSET-MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Staged {len(FILES)} Toy assets with .js modules, {sum((target / name).stat().st_size for name in manifest):,} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
