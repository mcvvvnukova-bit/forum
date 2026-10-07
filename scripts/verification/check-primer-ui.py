#!/usr/bin/env python3
"""Run the pinned Primer scanner with Forum's approved exact-file policy."""
import argparse
from dataclasses import asdict
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

BASE = Path(__file__).resolve().parent
SNAPSHOT_SHA256 = 'c926222170bb455281ebc2c6f2f279d75ef44143b7e41b18ea0fe0d0841a88e7'
APPROVED_PATHS = ('src/home/forum-tokens.css', 'src/audience/forum-tokens.css', 'src/auth/sber-tokens.css')


def load_scanner():
    policy = json.loads((BASE / 'primer-ui/policy.json').read_text(encoding='utf-8'))
    if (policy.get('schema_version') != 1
            or policy.get('allowed_token_paths') != list(APPROVED_PATHS)
            or policy.get('snapshot_sha256') != SNAPSHOT_SHA256):
        raise ValueError('invalid Primer policy: expected pinned snapshot and exact approved token paths')
    source = BASE / 'primer-ui/validate_primer_ui.py'
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != SNAPSHOT_SHA256:
        raise ValueError('Primer validator snapshot integrity mismatch')
    # Execute exactly the bytes that passed the integrity check, without a stale
    # bytecode cache or a second source read between verification and execution.
    spec = importlib.util.spec_from_file_location('forum_primer_validator', source)
    scanner = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = scanner
    exec(compile(data, str(source), 'exec'), scanner.__dict__)
    return scanner


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--root', type=Path, default=BASE.parents[1] / 'apps/web')
    parser.add_argument('--format', choices=('text', 'json'), default='text')
    args = parser.parse_args(argv)
    try:
        root = args.root.resolve(strict=True)
        mode = root.stat().st_mode
        if (not root.is_dir() or not mode & (stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
                or not mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
                or not os.access(root, os.R_OK | os.X_OK)):
            raise ValueError(f'unreadable root: {root}')
        scanner = load_scanner()
        findings = scanner.scan_project(root, APPROVED_PATHS)
    except Exception as error:
        print(f'error: unable to validate Primer UI: {error}', file=sys.stderr)
        return 2
    if args.format == 'json':
        print(json.dumps([asdict(finding) for finding in findings], indent=2))
    else:
        for finding in findings:
            print(f'{finding.severity.upper()} {finding.code} '
                  f'{finding.path}:{finding.line} {finding.message}')
    return int(any(finding.severity == 'error' for finding in findings))


if __name__ == '__main__':
    raise SystemExit(main())
