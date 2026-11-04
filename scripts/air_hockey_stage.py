#!/usr/bin/env python3
"""Copy the explicit offline runtime allowlist into a fresh build directory."""
import hashlib
import json
import shutil
import sys
from pathlib import Path

project = Path(__file__).resolve().parents[1]
source = project / 'web' / 'air-hockey'
if not source.is_dir():
    source = project  # The standalone GitHub Pages checkout keeps the game at its root.
target = Path(sys.argv[1])
target.mkdir(parents=True, exist_ok=True)
if any(target.iterdir()):
    raise SystemExit('Staging directory must be empty')
files = ['index.html', 'styles.css', 'game.mjs', 'physics.mjs', 'sfx.mjs', 'haptics.mjs', 'icon.svg']
files += ['promo/' + name for name in ['index.html', 'film.html', 'player.mjs', 'promo.mjs', 'timeline.mjs', 'rally.mjs', 'scene.mjs', 'camera3d.mjs', 'overlay.mjs', 'audio.mjs']]
files += ['promo/dist/air-hockey-collision-promo.mp4']
manifest = {}
for relative in files:
    origin = source / relative
    if origin.is_symlink() or not origin.is_file():
        raise SystemExit(f'Missing or symbolic runtime asset: {relative}')
    dest = target / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(origin, dest)
    manifest[relative] = hashlib.sha256(dest.read_bytes()).hexdigest()
(target / 'ASSET-MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Staged {len(files)} assets, {sum((target / name).stat().st_size for name in files):,} bytes')
