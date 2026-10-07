#!/usr/bin/env python3
"""Offline resource closure for the eight accepted mail/preview HTML sources."""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import re
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
OWNER = ROOT / 'deployment/mail/templates'

class Resources(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []
        self.tags = set()

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag)
        for name, value in attrs:
            if value and name in ('src', 'href', 'poster', 'background'):
                self.urls.append(value)
            if value and name == 'srcset':
                self.urls.extend(part.strip().split()[0] for part in value.split(','))


def verify():
    files = sorted(OWNER.rglob('*.html'))
    assert len(files) == 8, 'All eight template/preview sources are required'
    local, placeholders, external = [], [], []
    for source in files:
        text = source.read_text()
        parser = Resources()
        parser.feed(text)
        assert {'html', 'head', 'body'} <= parser.tags, source
        parser.urls.extend(re.findall(r'url\(\s*[\'"]?([^\)\'"\s]+)', text))
        for url in parser.urls:
            if re.fullmatch(r'\{\{[^{}]+\}\}|\$\{[^{}]+\}', url):
                placeholders.append(url)
                continue
            parsed = urlsplit(url)
            if parsed.scheme or parsed.netloc:
                assert parsed.scheme in ('http', 'https', 'mailto', 'tel', 'data') or not parsed.scheme, url
                external.append(url)
                continue
            if not parsed.path:
                continue  # fragment-only preview actions
            target = (source.parent / unquote(parsed.path)).resolve()
            assert target.is_relative_to(OWNER.resolve()), f'Escaping local resource: {source}: {url}'
            assert target.is_file() and not target.is_symlink(), f'Missing local resource: {source}: {url}'
            local.append(target.relative_to(OWNER).as_posix())
    logo = OWNER / 'logo.webp'
    accepted = ROOT / 'apps/legacy-landing/src/landing/assets/brand-logo-horizontal-color.webp'
    assert hashlib.sha256(logo.read_bytes()).digest() == hashlib.sha256(accepted.read_bytes()).digest()
    print(json.dumps({'htmlSources': len(files), 'localReferences': local,
                      'externalReferences': len(external), 'templateVariables': placeholders,
                      'mailSent': False}))

if __name__ == '__main__':
    verify()
