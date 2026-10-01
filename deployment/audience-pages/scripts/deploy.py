#!/usr/bin/env python3
"""Apply only the audience-page package, preserving the homepage and auth gateway."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from datetime import datetime, timezone

NAMES = ('customers', 'suppliers', 'work', 'participate', 'audience-assets')
MARKER = '<!-- audience-pages:resume -->\n<script src="/audience-assets/resume.js" defer></script>\n<!-- /audience-pages:resume -->'


def deploy(source, target, backups):
    source, target, backups = Path(source), Path(target), Path(backups)
    for name in NAMES:
        assert (source / name).is_dir(), f'Missing package directory: {name}'
    for route in NAMES[:-1]:
        assert (source / route / 'index.html').is_file(), f'Missing page: {route}'
    assert (source / 'audience-assets/resume.js').is_file(), 'Missing callback resume script'
    main = target / 'index.html'
    original = main.read_bytes()
    assert b'</body>' in original, 'Homepage body closing tag missing'
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = backups / ('audience-pages-' + stamp)
    backup.mkdir(parents=True)
    (backup / 'index.html').write_bytes(original)
    staging = Path(tempfile.mkdtemp(prefix='.audience-pages-', dir=target.parent))
    changed = []
    try:
        for name in NAMES:
            shutil.copytree(source / name, staging / name)
            for f in (staging / name).rglob('*'):
                f.chmod(0o755 if f.is_dir() else 0o644)
            (staging / name).chmod(0o755)
        for name in NAMES:
            dest = target / name
            if dest.exists(): dest.rename(backup / name)
            changed.append(name)
            (staging / name).rename(dest)
        updated = original if MARKER.encode() in original else original.replace(b'</body>', MARKER.encode() + b'\n</body>', 1)
        temp_main = target / '.index-audience.tmp'
        temp_main.write_bytes(updated)
        temp_main.chmod(0o644)
        temp_main.replace(main)
    except Exception:
        for name in reversed(changed):
            dest = target / name
            if dest.exists(): shutil.rmtree(dest)
            if (backup / name).exists(): (backup / name).rename(dest)
        main.write_bytes(original)
        raise
    finally:
        shutil.rmtree(staging)
    files = {str(p.relative_to(target)): hashlib.sha256(p.read_bytes()).hexdigest()
             for name in NAMES for p in (target / name).rglob('*') if p.is_file()}
    result = {'backup': str(backup), 'files': files, 'homepage_before': hashlib.sha256(original).hexdigest(),
              'homepage_after': hashlib.sha256(main.read_bytes()).hexdigest(),
              'homepage_only_resume_changed': main.read_bytes().replace((MARKER + '\n').encode(), b'') == original.replace((MARKER + '\n').encode(), b'')}
    (backup / 'result.json').write_text(json.dumps(result, indent=2))
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('source')
    p.add_argument('--target', default='/opt/outline/dev-astforum/landing')
    p.add_argument('--backups', default='/opt/outline/backups')
    args = p.parse_args()
    print(json.dumps(deploy(args.source, args.target, args.backups), indent=2))
