"""Publish prepared static landing files; retain a complete rollback copy."""
from pathlib import Path
import json
import os
import re
import shutil
import sys
import tempfile

source = Path(sys.argv[1])
target = Path('/opt/outline/dev-astforum/landing')
entries = [Path('index.html'), Path('customers/index.html')]
for entry in entries:
    html = (source / entry).read_text()
    for asset in re.findall(r'(?:src|href)="(/landing-assets/[^"]+)"', html):
        if not (source / asset.lstrip('/')).is_file():
            raise SystemExit(f'Missing staged asset: {asset}')

for asset in (source / 'landing-assets').iterdir():
    existing = target / 'landing-assets' / asset.name
    if existing.exists() and existing.read_bytes() != asset.read_bytes():
        raise SystemExit(f'Hashed asset collision: {asset.name}')

backup = Path(tempfile.mkdtemp(prefix='shared-demo-20261001-', dir='/opt/outline/backups'))
shutil.copytree(target, backup / 'landing')

try:
    for asset in (source / 'landing-assets').iterdir():
        shutil.copy2(asset, target / 'landing-assets' / asset.name)
        (target / 'landing-assets' / asset.name).chmod(0o644)
    for entry in entries:
        temporary = target / entry.parent / f'.{entry.name}.shared-demo.tmp'
        shutil.copy2(source / entry, temporary)
        temporary.chmod(0o644)
        os.replace(temporary, target / entry)
except Exception:
    for entry in entries:
        shutil.copy2(backup / 'landing' / entry, target / entry)
    raise

print(json.dumps({'published': [str(target / entry) for entry in entries], 'backup': str(backup / 'landing')}, ensure_ascii=False))
