"""Shared static-site compositor and publication transaction for component builds.

publish() accepts immutable source bytes, overlays owned pages, composes every
public HTML with the active auth contract, then verifies while holding one site
lock. Assets are additive and immutable; rollback restores only markup/state
still equal to this transaction's writes. It never removes asset directories.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile

AUTH_STATE = '.public-auth.json'
AUTH_TAG = re.compile(r'<(?:script\b[^>]*\bsrc|link\b[^>]*\bhref)=[\"\'](/public-auth-assets/[^\"\']+)[\"\'][^>]*(?:>\s*</script>|>)', re.I)
AUTH_BLOCK = re.compile(r'\n?<!-- public-auth:start -->.*?<!-- public-auth:end -->\n?', re.S)
RESUME_BLOCK = re.compile(r'<!-- audience-pages:resume -->.*?<!-- /audience-pages:resume -->\s*', re.S)
RESUME_TAG = re.compile(r'<script\b[^>]*\bsrc=[\"\']/audience-assets/resume\.js[\"\'][^>]*>\s*</script>', re.I)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def relative(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or '..' in path.parts or str(path) != name:
        raise ValueError('Unsafe release path: ' + name)
    return name


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.public-site-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install_asset(path, data):
    """Atomically add a complete file, without replacing existing hashed bytes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.public-asset-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
        os.chmod(temporary, 0o644)
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != data:
                raise RuntimeError('Concurrent immutable asset change: ' + str(path))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_optional(path):
    return path.read_bytes() if path.exists() else None


def validate_tree(root):
    root = Path(root)
    if root.is_symlink() or any(p.is_symlink() for p in root.rglob('*')):
        raise ValueError('Release tree contains symlinks: ' + str(root))


def build_files(source, directories):
    """Read owned asset files once; never modify the build directory."""
    source = Path(source)
    validate_tree(source)
    result = {}
    for directory in directories:
        if not (source / directory).is_dir():
            raise ValueError('Build assets missing: ' + directory)
        for path in sorted((source / directory).rglob('*')):
            if path.is_file():
                result[path.relative_to(source).as_posix()] = path.read_bytes()
    return result


def public_pages(target):
    result = {}
    for path in sorted(target.rglob('*.html')):
        name = path.relative_to(target).as_posix()
        parts = Path(name).parts
        if any(p.startswith('._') or p == '__MACOSX' or p.endswith('assets') or p == 'auth' for p in parts):
            continue
        result[name] = path.read_bytes()
    return result


def auth_contract(index, assets):
    """Require complete script/style loaders and their exact available bytes."""
    body = index.decode('utf-8')
    if '</head>' not in body:
        raise ValueError('Auth build is missing head')
    tags = list(AUTH_TAG.finditer(body))
    refs = [relative(match.group(1).lstrip('/')) for match in tags]
    if len(refs) != len(set(refs)) or not any(r.endswith('.js') for r in refs) or not any(r.endswith('.css') for r in refs):
        raise ValueError('Shared auth script/style missing or duplicated')
    for ref in refs:
        if ref not in assets:
            raise ValueError('Active auth asset missing: ' + ref)
    script = any(match.group(0).lower().startswith('<script') and ref.endswith('.js')
                 for match, ref in zip(tags, refs))
    stylesheet = any(match.group(0).lower().startswith('<link') and ref.endswith('.css')
                     and re.search(r'\brel=[\"\']stylesheet[\"\']', match.group(0), re.I)
                     for match, ref in zip(tags, refs))
    if not script or not stylesheet:
        raise ValueError('Shared auth requires an executable script and stylesheet')
    return {'version': 1, 'loaders': [match.group(0) for match in tags],
            'assets': {ref: sha(assets[ref]) for ref in refs}}


def active_auth(target, pages):
    """Recognize legacy canonical auth; distinguish absence from damaged state."""
    state = read_optional(target / AUTH_STATE)
    canonicals = [pages.get(route + '/index.html') for route in ('login', 'register')]
    # Assets alone may remain after a failed first install; canonical pages,
    # the manifest or any page loader prove an established installation.
    installed = state is not None or any(p is not None for p in canonicals)
    installed = installed or any(b'public-auth:start' in p or b'/public-auth-assets/' in p for p in pages.values())
    if not installed:
        return None
    if any(p is None for p in canonicals):
        raise ValueError('Established auth is damaged: login/register missing; restore canonical pages and assets')
    assets = {p.relative_to(target).as_posix(): p.read_bytes()
              for p in (target / 'public-auth-assets').rglob('*') if p.is_file()}
    first, second = (auth_contract(p, assets) for p in canonicals)
    if first != second:
        raise ValueError('Established auth is damaged: login/register loaders disagree')
    if state is not None:
        try:
            persisted = json.loads(state)
        except (ValueError, UnicodeError) as error:
            raise ValueError('Established auth manifest is malformed; restore ' + AUTH_STATE) from error
        if persisted != first:
            raise ValueError('Established auth manifest/assets disagree; restore canonical auth release')
    return first


def compose(page, contract):
    body = page.decode('utf-8')
    if '</head>' not in body:
        raise ValueError('Public HTML missing head')
    if body.count('<!-- public-auth:start -->') != body.count('<!-- public-auth:end -->'):
        raise ValueError('Public HTML has an incomplete auth block')
    body = AUTH_BLOCK.sub('', body)
    body = AUTH_TAG.sub('', body)
    body = RESUME_BLOCK.sub('', body)
    body = RESUME_TAG.sub('', body)
    snippet = '\n<!-- public-auth:start -->\n' + '\n'.join(contract['loaders']) + '\n<!-- public-auth:end -->\n'
    return body.replace('</head>', snippet + '</head>', 1).encode('utf-8')


@contextmanager
def site_lock(target):
    """Fail busy rather than deadlock nested verifiers; keep the lock inode."""
    path = target.parent / ('.' + target.name + '.public-site.lock')
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('Public site publication busy; retry after lock release: ' + str(path)) from error
        yield
    finally:
        os.close(fd)


def publish(source, target, backups, *, label, pages, assets, commit=None,
            install_auth=False, homepage_transform=None, verifier=None):
    """Common lifecycle. verifier(report) runs after writes and before success.

    report files are hashes of COMPOSED markup/assets. A failed transaction
    leaves additive assets readable. Rollback conflicts/errors identify the
    residual paths and backup for an operator; no parallel bytes are replaced.
    """
    source, target, backups = Path(source), Path(target), Path(backups)
    validate_tree(source)
    validate_tree(target)
    if not target.is_dir():
        raise ValueError('Existing public target missing')
    for name in list(pages) + list(assets):
        relative(name)
    with site_lock(target):
        validate_tree(target)
        existing = public_pages(target)
        current_contract = active_auth(target, existing)  # preflight before ANY site/backup write
        contract = auth_contract((source / 'index.html').read_bytes(), assets) if install_auth else current_contract
        proposed = dict(existing)
        proposed.update(pages)
        if homepage_transform and not contract:
            proposed['index.html'] = homepage_transform(existing['index.html'])
        if contract:
            proposed = {name: compose(data, contract) for name, data in proposed.items()}
        originals = {name: existing.get(name) for name in proposed}
        changes = {name: data for name, data in proposed.items() if data != originals[name]}
        if contract:
            originals[AUTH_STATE] = read_optional(target / AUTH_STATE)
            state = (json.dumps(contract, sort_keys=True, indent=2) + '\n').encode()
            if state != originals[AUTH_STATE]:
                changes[AUTH_STATE] = state
        # Never replace a retained hash with different bytes, even on failure.
        for name, data in assets.items():
            previous = read_optional(target / name)
            if previous is not None and previous != data:
                raise ValueError('Immutable asset collision: ' + name + '; publish a new hashed filename')
        backup = backups / (label + '-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        backup.mkdir(parents=True, mode=0o700)
        for name, data in originals.items():
            if data is not None:
                atomic_write(backup / name, data)
        report = {'commit': commit, 'backup': str(backup), 'target': str(target),
                  'files': {name: sha(data) for name, data in {**proposed, **assets}.items()},
                  'auth': contract, 'assetsRetainedOnRollback': True}
        written = []
        try:
            for name, data in assets.items():
                install_asset(target / name, data)
            for name, data in changes.items():
                path = target / name
                if read_optional(path) != originals[name]:
                    raise RuntimeError('Concurrent page/state change: ' + name)
                written.append(name)
                atomic_write(path, data)
            if verifier:
                report['checks'] = verifier(report)
            for name, data in assets.items():
                if read_optional(target / name) != data:
                    raise RuntimeError('Concurrent asset change after verification: ' + name)
            if contract and active_auth(target, public_pages(target)) != contract:
                raise RuntimeError('Concurrent auth contract change after verification')
            if public_pages(target) != proposed:
                raise RuntimeError('Concurrent public HTML inventory change after verification')
            for name, data in changes.items():
                if read_optional(target / name) != data:
                    raise RuntimeError('Concurrent page/state change after verification: ' + name)
            atomic_write(backup / 'deployment.json', (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode())
            return report
        except BaseException as error:
            residual = []
            for name in reversed(written):
                path = target / name
                try:
                    current = read_optional(path)
                    if current == originals[name]:
                        continue
                    if current != changes[name]:
                        residual.append({'path': name, 'reason': 'parallel bytes preserved'})
                        continue
                    original = originals[name]
                    if original is None:
                        path.unlink()
                    else:
                        atomic_write(path, original)
                except BaseException as rollback_error:
                    residual.append({'path': name, 'reason': str(rollback_error)})
            if residual:
                try:
                    atomic_write(backup / 'rollback-conflicts.json', (json.dumps(residual, indent=2) + '\n').encode())
                except OSError:
                    pass
                raise RuntimeError('Public site rollback incomplete; backup ' + str(backup) + '; residual ' + json.dumps(residual)) from error
            raise
