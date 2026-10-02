#!/usr/bin/env python3
"""Add the common auth component to dev HTML without rebuilding public pages."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

def sha(data): return hashlib.sha256(data).hexdigest()
def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name=tempfile.mkstemp(prefix='.public-auth-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as out: out.write(data)
        os.chmod(name,0o644); os.replace(name,path)
    finally:
        if os.path.exists(name): os.unlink(name)

def deploy(source, target, backups, commit, verifier=None):
    source=Path(source); target=Path(target); backups=Path(backups)
    if not (source/'index.html').is_file() or not (source/'public-auth-assets').is_dir():
        raise ValueError('Built form or assets missing')
    if any(p.is_symlink() for p in source.rglob('*')): raise ValueError('Build contains symlinks')
    index=(source/'index.html').read_text()
    loaders=re.findall(r'<(?:script|link)\b[^>]*(?:src|href)="/public-auth-assets/[^\"]+"[^>]*(?:></script>|>)',index)
    if len(loaders)<2: raise ValueError('Shared script/style missing')
    snippet='\n<!-- public-auth:start -->\n'+'\n'.join(loaders)+'\n<!-- public-auth:end -->\n'
    changes={}; originals={}
    for path in sorted(target.rglob('*.html')):
        if any(part.endswith('assets') for part in path.relative_to(target).parts): continue
        if path.relative_to(target).as_posix() in ['login/index.html','register/index.html']: continue
        original=path.read_bytes(); body=original.decode()
        if '</head>' not in body: raise ValueError('Missing head: '+str(path))
        body=re.sub(r'\n?<!-- public-auth:start -->.*?<!-- public-auth:end -->\n?', '',body,flags=re.S)
        # The obsolete callback marker restores a stored source/action; PUB.02.02
        # explicitly drops that behavior. Keep every other page script intact.
        body=re.sub(r'<script\b[^>]*src=[\"\']/audience-assets/resume\.js[\"\'][^>]*>\s*</script>','',body)
        changes[path]=body.replace('</head>',snippet+'</head>',1).encode(); originals[path]=original
    if not changes: raise ValueError('No public HTML found')
    for mode in ['login','register']:
        path=target/mode/'index.html'; originals[path]=path.read_bytes() if path.exists() else None
        changes[path]=(source/'index.html').read_bytes()
    backup=backups/('public-auth-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(parents=True,mode=0o700)
    for path,data in originals.items():
        if data is not None: atomic_write(backup/path.relative_to(target),data)
    written=[]
    report={'commit':commit,'backup':str(backup),'target':str(target),'files':{}}
    try:
        # Hashed assets are additive. Keep earlier hashes for pages already open.
        for path in sorted((source/'public-auth-assets').rglob('*')):
            if path.is_file(): atomic_write(target/path.relative_to(source),path.read_bytes())
        for path,data in changes.items():
            current=path.read_bytes() if path.exists() else None
            if current != originals[path]: raise RuntimeError('Concurrent page change: '+str(path))
            atomic_write(path,data); written.append(path); report['files'][str(path.relative_to(target))]=sha(data)
        for path in (source/'public-auth-assets').rglob('*'):
            if path.is_file(): report['files'][str(path.relative_to(source))]=sha(path.read_bytes())
        if verifier: verifier(report)
        (backup/'deployment.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        return report
    except BaseException as error:
        conflicts=[]
        for path in reversed(written):
            current=path.read_bytes() if path.exists() else None
            # Never overwrite a parallel publisher during rollback.
            if current != changes[path]:
                conflicts.append(str(path.relative_to(target))); continue
            data=originals[path]
            if data is not None: atomic_write(path,data)
            elif path.exists(): path.unlink()
        if conflicts:
            (backup/'rollback-conflicts.json').write_text(json.dumps(conflicts,ensure_ascii=False))
            raise RuntimeError('Parallel changes preserved during rollback: '+', '.join(conflicts)) from error
        raise

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('--target',type=Path,default=Path('/opt/outline/dev-astforum/landing'))
    parser.add_argument('--backups',type=Path,default=Path('/opt/outline/backups'))
    parser.add_argument('--commit',required=True)
    args=parser.parse_args()
    if args.target.resolve()!=Path('/opt/outline/dev-astforum/landing'): raise SystemExit('Only the dev public target is supported by CLI')
    print(json.dumps(deploy(args.source,args.target,args.backups,args.commit),ensure_ascii=False,indent=2))
