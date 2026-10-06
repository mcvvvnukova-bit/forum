#!/usr/bin/env python3
"""Publish audience routes through the mandatory shared site compositor."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from scripts.deployment.public_site import build_files, publish

NAMES = ('customers', 'suppliers', 'work', 'participate', 'audience-assets')
MARKER = '<!-- audience-pages:resume -->\n<script src="/audience-assets/resume.js" defer></script>\n<!-- /audience-pages:resume -->'


def deploy(source, target, backups, preserve_homepage=False, verifier=None):
    source, target = Path(source), Path(target)
    assets = build_files(source, ['audience-assets'])
    pages = {route + '/index.html': (source / route / 'index.html').read_bytes() for route in NAMES[:-1]}
    original = (target / 'index.html').read_bytes()

    def resume(body):
        if preserve_homepage or MARKER.encode() in body:
            return body
        if b'</body>' not in body:
            raise ValueError('Homepage body closing tag missing')
        return body.replace(b'</body>', MARKER.encode() + b'\n</body>', 1)

    result = publish(source, target, backups, label='audience-pages', pages=pages,
                     assets=assets, homepage_transform=resume, verifier=verifier)
    updated = (target / 'index.html').read_bytes()
    result.update(homepage_before=hashlib.sha256(original).hexdigest(),
                  homepage_after=hashlib.sha256(updated).hexdigest(),
                  homepage_only_resume_changed=updated.replace((MARKER + '\n').encode(), b'') == original.replace((MARKER + '\n').encode(), b''))
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('source')
    p.add_argument('--target', default='/opt/outline/dev-astforum/landing')
    p.add_argument('--backups', default='/opt/outline/backups')
    p.add_argument('--preserve-homepage', action='store_true', help='Keep an independently managed homepage and its callback unchanged')
    args = p.parse_args()
    print(json.dumps(deploy(args.source, args.target, args.backups, preserve_homepage=args.preserve_homepage), indent=2))
