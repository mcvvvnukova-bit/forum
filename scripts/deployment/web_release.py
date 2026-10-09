#!/usr/bin/env python3
"""Publish a verified web build through an atomic exchange inside a stable bind.

Linux only. The bound parent inode remains unchanged; gateway/Caddy must resolve
landing paths on each request. Caller supplies fresh target CAS and served verifier.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.deployment.public_site import atomic_write, install_asset, relative, sha, site_lock, validate_tree


def inventory(root):
    validate_tree(root)
    return {p.relative_to(root).as_posix(): sha(p.read_bytes())
            for p in sorted(root.rglob('*')) if p.is_file()}


def fingerprint(files):
    # Same canonicalization as JS JSON.stringify over sorted file names.
    return sha(json.dumps(files, ensure_ascii=False, separators=(',', ':')).encode())


def exchange(left, right):
    """Atomic even on the initial real-directory transition; never two renames."""
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, 'renameat2', None)
    if rename is None:
        raise RuntimeError('Linux renameat2 required; target was not switched')
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    if rename(-100, os.fsencode(left), -100, os.fsencode(right), 2) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def validate_artifact(artifact, source_sha, environment):
    validate_tree(artifact)
    if set(p.name for p in artifact.iterdir()) != {'manifest.json', 'site'}:
        raise ValueError('Artifact permits only manifest.json and site/')
    manifest = json.loads((artifact / 'manifest.json').read_text())
    required = {'schemaVersion','recordKind','reconciliationStatus','environment','sourceSha','sourceTree','sourceFingerprint','inputs','config','configFingerprint','lockFingerprint','installedDependencyFingerprint','toolchain','buildMode','files','artifactFingerprint','routes'}
    if set(manifest) != required or manifest['schemaVersion'] != 2 or manifest['recordKind'] != 'build' or manifest['reconciliationStatus'] != 'build-only':
        raise ValueError('Expected strict build-only v2 manifest')
    if manifest['sourceSha'] != source_sha or manifest['environment'] != environment:
        raise ValueError('Source/environment mismatch')
    files = inventory(artifact / 'site')
    if files != manifest['files'] or fingerprint(files) != manifest['artifactFingerprint']:
        raise ValueError('Artifact bytes/inventory mismatch')
    for name in files:
        relative(name)
        if name.startswith('.') or any(part.startswith('.') for part in Path(name).parts):
            raise ValueError('Hidden artifact file')
    if fingerprint(manifest['inputs']) != manifest['sourceFingerprint'] or fingerprint(manifest['config']) != manifest['configFingerprint']:
        raise ValueError('Input/config fingerprint mismatch')
    routes = ['/', '/customers/', '/suppliers/', '/work/', '/participate/', '/login', '/cabinet/', '/cabinet/work/', '/cabinet/organizations/'] if environment == 'dev' else ['/']
    if manifest['routes'] != routes:
        raise ValueError('Route inventory mismatch')
    pages = {('index.html' if route == '/' else route.strip('/') + '/index.html') for route in routes}
    if {name for name in files if name.endswith('.html')} != pages:
        raise ValueError('Unexpected page ownership')
    if environment == 'dev':
        if manifest['config'] != {'VITE_FORUM_SESSION':'true','VITE_LOGIN_URL':'/login','VITE_START_URL':'/login'}:
            raise ValueError('Dev configuration mismatch')
        for name in files:
            if name not in pages and not name.startswith(('web-assets/', 'web-media/')):
                raise ValueError('Non-immutable dev asset')
    return manifest, pages


def deploy(artifact, target, backups, *, source_sha, expected_target, environment, verifier):
    artifact, target, backups = Path(artifact), Path(target), Path(backups)
    if environment != 'dev':
        raise ValueError('This publisher owns dev only; production is separate static reconciliation')
    if not callable(verifier):
        raise ValueError('Post-switch served verifier is required')
    manifest, pages = validate_artifact(artifact, source_sha, environment)
    with site_lock(target):
        before = inventory(target)
        if fingerprint(before) != expected_target:
            raise RuntimeError('Target preflight drift; capture fresh evidence before retry')
        operation = uuid.uuid4().hex
        backup = backups / ('web-' + operation)
        backup.mkdir(parents=True, mode=0o700)
        os.chmod(backup, 0o700)
        shutil.copytree(target, backup / 'before')
        prepared = target.parent / ('.web-prepared-' + operation)
        shutil.copytree(target, prepared)
        try:
            for name in manifest['files']:
                if name in pages:
                    atomic_write(prepared / name, (artifact / 'site' / name).read_bytes())
                else:
                    data = (artifact / 'site' / name).read_bytes()
                    install_asset(prepared / name, data)
                    # Available to newly opened pages even after rollback.
                    install_asset(target / name, data)
            # Retire only the previously owned page in the prepared tree. Its
            # absence activates the gateway alias; exchanging back restores it.
            (prepared / 'register/index.html').unlink(missing_ok=True)
            (prepared / '.public-auth.json').unlink(missing_ok=True)
            atomic_write(prepared / '.web-release.json', (artifact / 'manifest.json').read_bytes())
            previous = inventory(target)
            expected_previous = dict(before)
            expected_previous.update({name:digest for name,digest in manifest['files'].items() if name not in pages})
            if previous != dict(sorted(expected_previous.items())):
                raise RuntimeError('Concurrent target change during preparation')
            proposed = inventory(prepared)
            report = {'sourceSha':source_sha, 'environment':environment, 'operationId':operation,
                      'artifactFingerprint':manifest['artifactFingerprint'], 'previousFingerprint':fingerprint(before),
                      'servedTreeFingerprint':fingerprint(proposed), 'backup':str(backup),
                      'assetsRetainedOnRollback':True, 'switch':'renameat2-exchange-within-stable-parent'}
            atomic_write(backup / 'prepared.json', (json.dumps(report, indent=2)+'\n').encode())
            exchange(target, prepared)
            try:
                report['checks'] = verifier(report)
                if inventory(target) != proposed:
                    raise RuntimeError('Concurrent target change after verification')
            except BaseException as error:
                if inventory(target) != proposed or inventory(prepared) != previous:
                    atomic_write(backup / 'rollback-conflicts.json', b'{"reason":"Concurrent bytes preserved; automatic rollback refused"}\n')
                    raise RuntimeError('Rollback CAS conflict; concurrent bytes preserved; backup '+str(backup)) from error
                exchange(target, prepared)
                if inventory(target) != previous:
                    raise RuntimeError('Rollback verification failed; backup '+str(backup)) from error
                atomic_write(backup / 'rolled-back.json', (json.dumps(report, indent=2)+'\n').encode())
                raise
            shutil.move(str(prepared), str(backup / 'previous-with-retained-assets'))
            atomic_write(backup / 'deployment.json', (json.dumps(report, indent=2)+'\n').encode())
            return report
        finally:
            # A conflict must preserve BOTH trees for operator recovery.
            if prepared.exists() and not (backup / 'rollback-conflicts.json').exists():
                shutil.move(str(prepared), str(backup / 'prepared-or-failed'))


def rollback(target, release_backup, backups, *, expected_target, verifier):
    """Restore owned pages/state from one exact successful release backup.

    Assets and independently owned files remain current. Failed rollback verifier
    exchanges back to the starting tree, provided both CAS fingerprints still own it.
    """
    target, release_backup, backups = Path(target), Path(release_backup), Path(backups)
    if not callable(verifier):
        raise ValueError('Rollback served verifier required')
    before_source = release_backup / 'before'
    validate_tree(before_source)
    if not (release_backup / 'deployment.json').is_file():
        raise ValueError('Rollback requires an exact successful release backup')
    with site_lock(target):
        current = inventory(target)
        if fingerprint(current) != expected_target:
            raise RuntimeError('Rollback target preflight drift')
        operation = uuid.uuid4().hex
        receipt = backups / ('rollback-' + operation)
        receipt.mkdir(parents=True, mode=0o700)
        os.chmod(receipt, 0o700)
        prepared = target.parent / ('.web-rollback-' + operation)
        shutil.copytree(target, prepared)
        pages = ['index.html'] + [name+'/index.html' for name in ['customers','suppliers','work','participate','login','register','cabinet','cabinet/work','cabinet/organizations']]
        for name in pages + ['.public-auth.json', '.web-release.json']:
            source = before_source / name
            if source.exists(): atomic_write(prepared / name, source.read_bytes())
            else: (prepared / name).unlink(missing_ok=True)
        # All original hashes must still be available; never delete a newer hash.
        for name in inventory(before_source):
            if name.startswith(('assets/', 'audience-assets/', 'public-auth-assets/', 'web-assets/', 'web-media/')):
                install_asset(prepared / name, (before_source / name).read_bytes())
        proposed = inventory(prepared)
        if inventory(target) != current:
            raise RuntimeError('Concurrent rollback preparation change; prepared tree '+str(prepared))
        report = {'operationId':operation, 'rollbackOf':str(release_backup), 'servedTreeFingerprint':fingerprint(proposed), 'assetsRetained':True}
        exchange(target, prepared)
        try:
            report['checks'] = verifier(report)
            if inventory(target) != proposed:
                raise RuntimeError('Concurrent rollback verification change')
        except BaseException as error:
            if inventory(target) != proposed or inventory(prepared) != current:
                atomic_write(receipt / 'rollback-conflicts.json', b'{"reason":"Concurrent bytes preserved"}\n')
                raise RuntimeError('Rollback CAS conflict; both trees preserved at '+str(prepared)) from error
            exchange(target, prepared)
            raise
        finally:
            if prepared.exists() and not (receipt / 'rollback-conflicts.json').exists():
                shutil.move(str(prepared), str(receipt / 'previous'))
        atomic_write(receipt / 'rollback.json', (json.dumps(report, indent=2)+'\n').encode())
        return report


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact',type=Path,nargs='?')
    parser.add_argument('--rollback-backup',type=Path)
    parser.add_argument('--target',type=Path,required=True)
    parser.add_argument('--backups',type=Path,required=True)
    parser.add_argument('--source-sha')
    parser.add_argument('--expected-target',required=True)
    parser.add_argument('--environment',choices=['dev'],required=True)
    parser.add_argument('--verify-command',nargs='+',required=True)
    args=parser.parse_args()
    if args.target != Path('/opt/outline/dev-astforum/landing'):
        raise SystemExit('CLI target must be the observed dev landing inside its stable parent bind')
    def verify(report):
        subprocess.run(args.verify_command,check=True)
        return {'commandSucceeded':True, 'receipt':'Caller must save independent origin/HTTPS/browser evidence'}
    if args.rollback_backup and not args.artifact:
        result=rollback(args.target,args.rollback_backup,args.backups,expected_target=args.expected_target,verifier=verify)
    elif args.artifact and not args.rollback_backup and args.source_sha:
        result=deploy(args.artifact,args.target,args.backups,source_sha=args.source_sha,expected_target=args.expected_target,environment=args.environment,verifier=verify)
    else:
        raise SystemExit('Choose an artifact+source-sha or one exact rollback-backup')
    print(json.dumps(result,indent=2))
