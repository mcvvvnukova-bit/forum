#!/usr/bin/env python3
"""Fail closed before job steps; this file is baked outside the writable runner home."""
import json
import os
from pathlib import Path
import sys

REPOSITORY = 'mcvvvnukova-bit/forum'


def trusted(event_name, repository, payload):
    if repository != REPOSITORY or not isinstance(payload, dict):
        return False
    if event_name in ('push', 'workflow_dispatch'):
        return payload.get('repository', {}).get('full_name') == REPOSITORY
    if event_name == 'pull_request':
        pr = payload.get('pull_request', {})
        return (pr.get('head', {}).get('repo', {}).get('full_name') == REPOSITORY
                and pr.get('base', {}).get('repo', {}).get('full_name') == REPOSITORY)
    return False


def main():
    try:
        payload = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
        accepted = trusted(os.environ['GITHUB_EVENT_NAME'], os.environ['GITHUB_REPOSITORY'], payload)
    except (KeyError, ValueError, OSError, TypeError, AttributeError):
        accepted = False
    if not accepted:
        print('Local CI rejected an untrusted or malformed job event', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
