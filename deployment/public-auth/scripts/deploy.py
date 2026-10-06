#!/usr/bin/env python3
"""Compose the shared auth release into every public HTML page."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from scripts.deployment.public_site import build_files, publish


def deploy(source, target, backups, commit, verifier=None):
    source = Path(source)
    assets = build_files(source, ['public-auth-assets'])
    index = (source / 'index.html').read_bytes()
    return publish(source, target, backups, label='public-auth',
                   pages={route + '/index.html': index for route in ('login', 'register')},
                   assets=assets, commit=commit, install_auth=True, verifier=verifier)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('--target',type=Path,default=Path('/opt/outline/dev-astforum/landing'))
    parser.add_argument('--backups',type=Path,default=Path('/opt/outline/backups'))
    parser.add_argument('--commit',required=True)
    args=parser.parse_args()
    if args.target.resolve()!=Path('/opt/outline/dev-astforum/landing'): raise SystemExit('Only the dev public target is supported by CLI')
    print(json.dumps(deploy(args.source,args.target,args.backups,args.commit),ensure_ascii=False,indent=2))
