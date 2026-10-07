#!/usr/bin/env python3
"""Validate selected operational source offline; never invoke its administrators."""
import ast
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
RUBY = 'openproject/openproject@sha256:8e49371d8d2aa5b92a40231687076fa3eaa2c98ff1f4f1789e1fe9da5fd838f9'
CADDY = 'caddy@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d'


def run(*argv, cwd=ROOT):
    result = subprocess.run(argv, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f'{argv[0]} validation failed: {result.stderr}')
    return result.stdout


# Task7 is a new explicit current-ownership layer. Task4 source pins and Task5/6
# snapshots remain byte-identical; no previous dated proof is rewritten.
def current_file(candidate, expected_hash, expected_mode):
    receipt_path = ROOT / 'artifacts/repository-audits/task-7-source-ownership.json'
    if not receipt_path.exists():
        return ROOT / candidate, expected_hash, expected_mode
    receipt = json.loads(receipt_path.read_text())
    assert receipt['baseSha'] == 'a56b52ed05a5f1fbe267dafcfe5d41ce1042916b'
    changes = receipt['changes']
    assert len({item['previousCandidatePath'] for item in changes}) == len(changes), 'Duplicate Task7 ownership'
    explicit = {'apps/api/Dockerfile', 'package.json', 'package-lock.json', '.github/workflows/quality.yml',
                'vitest.composition.config.ts', 'README.md', 'deployment/release.md',
                'deployment/release-manifest.schema.json', 'scripts/deployment/public_site.py',
                'scripts/verification/check-built-public-site.py',
                'scripts/verification/check-operational-sources.py',
                'scripts/verification/check-repository-layout.mjs',
                'scripts/verification/repository-layout.json', 'scripts/verification/checks.test.mjs',
                'scripts/verification/quality-gate.mjs', 'tests/integration/public-site-composition.test.tsx',
                'tests/integration/README.md',
                # Final Task7/8 ownership closure: retire the fourth publisher.
                'scripts/deployment/legacy-landing/deploy.sh',
                'apps/legacy-landing/README.md',
                'apps/legacy-landing/tests/test_deploy_rollback.py'}
    for item in changes:
        old = item['previousCandidatePath']
        assert old in explicit or old.startswith(('apps/primer-home/', 'apps/audience-pages/', 'apps/public-auth/')), 'Out-of-scope Task7 ownership'
        new = Path(item['candidatePath'])
        assert not new.is_absolute() and '..' not in new.parts, 'Unsafe Task7 owner'
        assert str(new) in explicit or str(new).startswith(('apps/web/', 'apps/primer-home/', 'apps/audience-pages/', 'apps/public-auth/', 'scripts/deployment/build-web-release')), 'Out-of-scope Task7 replacement'
    change = next((item for item in changes if item['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'Task7 baseline pin mismatch: ' + candidate
        resolved = (change['candidatePath'], change['candidateSha256'], change['candidateMode'])
    else:
        resolved = (candidate, expected_hash, expected_mode)
    return public_entry_file(*governance_file(*resolved))


# Preserve all dated predecessor receipts. This task can replace only these
# existing public entry and verification files, without moving or chmod'ing them.
PUBLIC_ENTRY_PATHS = {
    'apps/web/src/audience/App.tsx', 'apps/web/src/audience/audience.test.tsx',
    'apps/web/src/auth/PublicAuth.tsx', 'apps/web/src/home/config.ts',
    'apps/web/src/home/home.test.tsx', 'packages/public-navigation.ts',
    'deployment/web/build-config.json', 'deployment/release-manifest.schema.json',
    'scripts/deployment/web_release.py', 'tests/e2e/public-site.spec.ts',
    'tests/integration/public-site-composition.test.tsx', 'vitest.composition.config.ts',
    'scripts/verification/check-operational-sources.py', 'scripts/verification/checks.test.mjs',
}


def public_entry_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-31-public-entry-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-31'
    assert receipt['baseSha'] == '36277f1094a6514709b2bf5eb6c9737c9361a213', 'PROJ-31 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(PUBLIC_ENTRY_PATHS), 'Duplicate or missing PROJ-31 owner'
    assert {item['previousCandidatePath'] for item in changes} == PUBLIC_ENTRY_PATHS, 'Out-of-scope PROJ-31 owner'
    for item in changes:
        assert item['candidatePath'] == item['previousCandidatePath'], 'PROJ-31 owner cannot move'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-31 mode must stay unchanged'
        for key in ('previousSha256', 'candidateSha256'):
            assert len(item[key]) == 64 and all(c in '0123456789abcdef' for c in item[key]), 'Invalid PROJ-31 hash'
    return receipt


def public_entry_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((item for item in public_entry_receipt()['changes'] if item['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-31 predecessor pin mismatch: ' + candidate
        return sber_auth_file(ROOT / candidate, change['candidateSha256'], change['candidateMode'])
    return sber_auth_file(ROOT / candidate, expected_hash, expected_mode)


SBER_AUTH_PATHS = {
    'apps/api/README.md', 'apps/api/src/iam/auth-store.ts', 'apps/api/src/iam/auth.controller.ts',
    'apps/api/src/migrate.ts', 'apps/api/test/auth.test.ts', 'apps/api/test/browser-smoke.mjs',
    'apps/web/src/audience/intent.ts', 'apps/web/src/auth/PublicAuth.test.tsx',
    'apps/web/src/auth/PublicAuth.tsx', 'apps/web/src/home/App.tsx', 'apps/web/src/home/home.test.tsx',
    'tests/e2e/public-site.spec.ts', 'scripts/verification/check-operational-sources.py',
    'scripts/verification/checks.test.mjs', 'tests/integration/test_primer_ui_policy.py',
}
SBER_AUTH_NEW_PATHS = {
    'apps/api/migrations/004_individual_role.sql', 'apps/web/src/home/Cabinet.tsx',
    'docs/plans/2026-10-08-PROJ-155-sber-unified-auth.md',
}


def sber_auth_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-155-sber-auth-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-155'
    assert receipt['baseSha'] == '49241fd9fd8b5a733c5ef7350766c9c8650dc744', 'PROJ-155 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(SBER_AUTH_PATHS) and {x['previousCandidatePath'] for x in changes} == SBER_AUTH_PATHS, 'Out-of-scope PROJ-155 owner'
    for item in changes:
        assert item['candidatePath'] == item['previousCandidatePath'], 'PROJ-155 owner cannot move'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-155 mode must stay unchanged'
        for key in ('previousSha256', 'candidateSha256'):
            assert len(item[key]) == 64 and all(c in '0123456789abcdef' for c in item[key]), 'Invalid PROJ-155 hash'
    sources = receipt['newFiles']
    assert len(sources) == len(SBER_AUTH_NEW_PATHS) and {x['path'] for x in sources} == SBER_AUTH_NEW_PATHS, 'Out-of-scope PROJ-155 source'
    for item in sources:
        source = ROOT / item['path']
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == item['sha256'], 'PROJ-155 source hash mismatch: ' + item['path']
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-155 source mode mismatch'
    return receipt


def sber_auth_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((x for x in sber_auth_receipt()['changes'] if x['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-155 predecessor pin mismatch: ' + candidate
        return ROOT / candidate, change['candidateSha256'], change['candidateMode']
    return ROOT / candidate, expected_hash, expected_mode



# PROJ-154 changes verification governance only. The old Task5/6/7 receipts
# stay immutable; this exact-path layer pins the resolved current predecessor.
GOVERNANCE_PATHS = {
    'package.json', '.github/workflows/quality.yml',
    'scripts/verification/repository-layout.json',
    'scripts/verification/check-operational-sources.py',
    'scripts/verification/checks.test.mjs',
}
PRIMER_SOURCE_PATHS = {
    'scripts/verification/check-primer-ui.py',
    'scripts/verification/primer-ui/policy.json',
    'scripts/verification/primer-ui/validate_primer_ui.py',
    'tests/integration/test_primer_ui_policy.py',
}
HISTORICAL_RECEIPTS = {
    'artifacts/repository-audits/accepted-source-matrix.json',
    'artifacts/repository-audits/task-5-source-parity.json',
    'artifacts/repository-audits/task-6-source-ownership.json',
    'artifacts/repository-audits/task-7-source-ownership.json',
}


def governance_receipt(verify_history=False):
    path = ROOT / 'artifacts/repository-audits/proj-154-verification-ownership.json'
    assert path.is_file() and not path.is_symlink(), 'Missing PROJ-154 governance receipt'
    receipt = json.loads(path.read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-154'
    assert receipt['baseSha'] == 'f53901d129d78b1df1f0d89e5b7462734856d781'
    changes = receipt['changes']
    assert len(changes) == len(GOVERNANCE_PATHS), 'Duplicate or missing PROJ-154 governance owner'
    assert {item['previousCandidatePath'] for item in changes} == GOVERNANCE_PATHS, 'Out-of-scope PROJ-154 governance owner'
    for item in changes:
        assert item['candidatePath'] == item['previousCandidatePath'], 'PROJ-154 governance owner cannot move'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-154 governance mode must stay unchanged'
        for key in ('previousSha256', 'candidateSha256'):
            assert len(item[key]) == 64 and all(c in '0123456789abcdef' for c in item[key]), 'Invalid PROJ-154 hash'
    sources = receipt['newFiles']
    assert len(sources) == len(PRIMER_SOURCE_PATHS) and {item['path'] for item in sources} == PRIMER_SOURCE_PATHS, 'Out-of-scope PROJ-154 source'
    historical = receipt['historicalReceipts']
    assert len(historical) == len(HISTORICAL_RECEIPTS) and {item['path'] for item in historical} == HISTORICAL_RECEIPTS, 'Invalid historical receipt scope'
    for item in sources + (historical if verify_history else []):
        source, digest, _ = sber_auth_file(ROOT / item['path'], item['sha256'], item['mode'])
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, 'PROJ-154 receipt hash mismatch: ' + item['path']
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-154 source mode mismatch'
    return receipt


def governance_file(candidate, expected_hash, expected_mode):
    receipt = governance_receipt()
    change = next((item for item in receipt['changes'] if item['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-154 baseline pin mismatch: ' + candidate
        return ROOT / candidate, change['candidateSha256'], change['candidateMode']
    return ROOT / candidate, expected_hash, expected_mode


def verify_current(candidate, expected_hash, expected_mode):
    path, digest, mode = current_file(candidate, expected_hash, expected_mode)
    assert path.is_file() and not path.is_symlink(), candidate
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, str(path)
    assert ('100755' if path.stat().st_mode & 0o111 else '100644') == mode, str(path)
    return path


def verify_provenance():
    matrix = json.loads((ROOT / 'artifacts/repository-audits/accepted-source-matrix.json').read_text())
    assert matrix['schemaVersion'] == 1
    accepted = 0
    for component in matrix['components']:
        assert len(component['sourceSha']) == 40
        for file in component['files']:
            candidate = file.get('candidatePath')
            if not candidate:
                continue
            verify_current(candidate, file['candidateSha256'], file['candidateMode'])
            # Historical Git blob remains a pin of the originally accepted bytes;
            # current changed content is independently SHA-verified by Task7.
            path, digest, _ = current_file(candidate, file['candidateSha256'], file['candidateMode'])
            if digest == file['candidateSha256']:
                data = path.read_bytes()
                blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
                assert blob == file['candidateGitBlob'], candidate
            accepted += 1
    assert accepted > 0
    parity_path = ROOT / 'artifacts/repository-audits/task-5-source-parity.json'
    parity = json.loads(parity_path.read_text())
    documentation = matrix.get('task6', {}).get('currentDocumentationOwnership', [])
    verification = matrix.get('task6', {}).get('currentVerificationOwnership', [])
    changes = {item['previousCandidatePath']: item for item in documentation + verification}
    assert len(changes) == len(documentation) + len(verification), 'Duplicate Task6 ownership override'
    known_documents = {file['newPath'] for file in parity['files'] if Path(file['newPath']).suffix == '.md'}
    policy_paths = {'scripts/verification/check-operational-sources.py', 'scripts/verification/check-repository-layout.mjs',
                    'scripts/verification/repository-layout.json', 'scripts/verification/checks.test.mjs'}
    for item in documentation:
        assert item['previousCandidatePath'] in known_documents, 'Unknown or runtime documentation parity override'
        candidate = Path(item['candidatePath'])
        assert not candidate.is_absolute() and '..' not in candidate.parts and candidate.suffix == '.md', 'Task6 current owner must be a safe Markdown path'
        assert item['candidateMode'] == '100644', 'Task6 documentation cannot acquire executable mode'
    for item in verification:
        assert item['previousCandidatePath'] in policy_paths, 'Unknown or runtime verification parity override'
        assert item['candidatePath'] == item['previousCandidatePath'], 'Task6 verification owner cannot move'
        assert item['candidateMode'] == item['previousMode'], 'Task6 verification mode must stay unchanged'
    if changes:
        assert hashlib.sha256(parity_path.read_bytes()).hexdigest() == matrix['task6']['task5SnapshotSha256'], 'Historical Task5 parity snapshot changed'
    ownership = json.loads((ROOT / 'artifacts/repository-audits/task-6-source-ownership.json').read_text())
    assert ownership['schemaVersion'] == 1
    assert hashlib.sha256((ROOT / 'artifacts/repository-audits/accepted-source-matrix.json').read_bytes()).hexdigest() == ownership['acceptedSourceMatrixSha256'], 'Current accepted matrix receipt changed'
    pins = [{**{key: component[key] for key in ['id', 'pullRequest', 'sourceSha', 'sourcePrefixes', 'taskCodes']},
             'files': [{key: file[key] for key in ['sourcePath', 'sourceMode', 'sourceGitBlob', 'sourceSha256']} for file in component['files']]}
            for component in matrix['components']]
    digest = hashlib.sha256(json.dumps(pins, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    assert digest == ownership['immutableSourcePinsSha256'], 'Immutable source pins changed'
    for file in parity['files']:
        if file['newPath'] == 'artifacts/repository-audits/accepted-source-matrix.json':
            assert file['newSha256'] == ownership['previousAcceptedSourceMatrixSha256'], 'Historical accepted matrix pin changed'
            assert file['newMode'] == ownership['mode'] == '100644'
            continue
        change = changes.get(file['newPath'])
        if change:
            assert change['previousSha256'] == file['newSha256'] and change['previousMode'] == file['newMode'], file['newPath']
            # The dated Task5 snapshot stays immutable; verify current ownership separately.
            verify_current(change['candidatePath'], change['candidateSha256'], change['candidateMode'])
        else:
            verify_current(file['newPath'], file['newSha256'], file['newMode'])
        if file['unchanged']:
            assert file['previousSha256'] == file['newSha256'] and file['previousMode'] == file['newMode']
    receipt_path = ROOT / 'artifacts/repository-audits/task-7-source-ownership.json'
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text())
        for item in receipt['changes']:
            verify_current(item['previousCandidatePath'], item['previousSha256'], item['previousMode'])
        for item in receipt['newFiles']:
            path, digest, _ = public_entry_file(ROOT / item['path'], item['sha256'], '100644')
            assert path.is_file() and not path.is_symlink(), item['path']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, item['path']
    governance = governance_receipt(verify_history=True)
    for item in governance['changes']:
        path, digest, _ = public_entry_file(ROOT / item['candidatePath'], item['candidateSha256'], item['candidateMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-154 current hash mismatch: ' + item['candidatePath']
        assert not path.stat().st_mode & 0o111, 'PROJ-154 current mode mismatch'
    for item in public_entry_receipt()['changes']:
        path, digest, _ = sber_auth_file(ROOT / item['candidatePath'], item['candidateSha256'], item['candidateMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-31 current hash mismatch: ' + item['candidatePath']
        assert not path.stat().st_mode & 0o111, 'PROJ-31 current mode mismatch'
    for item in sber_auth_receipt()['changes']:
        path = ROOT / item['candidatePath']
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item['candidateSha256'], 'PROJ-155 current hash mismatch: ' + item['candidatePath']
        assert not path.stat().st_mode & 0o111, 'PROJ-155 current mode mismatch'
    return accepted


class Template(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = set()

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag)


def main():
    count = verify_provenance()
    run("python3", str(ROOT / "scripts/verification/check-mail-resources.py"))
    owners = ['deployment/mail', 'deployment/openproject', 'deployment/pgadmin', 'deployment/vps/outline']
    tool_owners = ['scripts/deployment/forum-db', 'scripts/deployment/pgadmin', 'scripts/deployment/mail',
                   'scripts/verification/mail', 'scripts/maintenance/mail', 'scripts/maintenance/openproject']
    for owner in owners + tool_owners:
        for path in (ROOT / owner).rglob('*'):
            if path.suffix == '.py':
                ast.parse(path.read_text(), filename=str(path))
            elif path.suffix == '.sh':
                run('bash', '-n', str(path))
            elif path.suffix == '.rb':
                run('docker', 'run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'ruby', '-v', f'{path}:/candidate.rb:ro', RUBY, '-c', '/candidate.rb')
    # Resolve administrative source contracts without importing or running any
    # administrator (install-caddy-routes has deliberate top-level side effects).
    mail = ROOT / 'scripts/deployment/mail'
    helper = ast.parse((mail / 'stalwart_api.py').read_text())
    exported = {node.name for node in helper.body if isinstance(node, ast.FunctionDef)}
    exported |= {target.id for node in helper.body if isinstance(node, ast.Assign)
                 for target in node.targets if isinstance(target, ast.Name)}
    for name in ['configure_acme.py', 'deploy-certificate.py']:
        imports = [node for node in ast.walk(ast.parse((mail / name).read_text()))
                   if isinstance(node, ast.ImportFrom) and node.module == 'stalwart_api']
        assert len(imports) == 1 and imports[0].level == 0, name
        assert {alias.name for alias in imports[0].names} <= exported, name
    pgadmin = ast.parse((ROOT / 'scripts/deployment/pgadmin/configure-admin.py').read_text())
    source = next(node.value for node in pgadmin.body if isinstance(node, ast.Assign)
                  and any(isinstance(target, ast.Name) and target.id == 'SOURCE' for target in node.targets))
    expected = ast.parse("Path(__file__).resolve().parents[3] / 'deployment' / 'pgadmin'", mode='eval').body
    assert ast.dump(source) == ast.dump(expected), 'pgAdmin configuration owner'
    for name in ['servers.json', 'compose.yaml']:
        assert (ROOT / 'deployment/pgadmin' / name).is_file(), name
    run('node', '--check', str(ROOT / 'scripts/verification/forum-api/test-callback-relay.mjs'))
    templates = sorted((ROOT / 'deployment/mail/templates').rglob('*.html'))
    assert len(templates) == 8
    for path in templates:
        parser = Template()
        parser.feed(path.read_text())
        assert {'html', 'head', 'body'} <= parser.tags, str(path)
        if path.name == 'index.html':
            assert 'iframe' in parser.tags and 'src="email.html"' in path.read_text()
        else:
            assert 'table' in parser.tags, str(path)

    # Copy source only into a disposable directory. Missing runtime env files
    # get synthetic empty fixtures; no live secret/env file is read or generated.
    with tempfile.TemporaryDirectory(prefix='forum-operational-check-') as directory:
        temp = Path(directory)
        for owner in owners + ['deployment/forum-api']:
            target = temp / owner
            target.mkdir(parents=True)
            for path in (ROOT / owner).glob('*'):
                if path.is_file() and path.suffix in ('.yaml', '.example'):
                    shutil.copyfile(path, target / path.name)
            (target / '.env').write_text('POSTGRES_PASSWORD=synthetic-check-only\nOPENPROJECT_SMTP__PASSWORD=synthetic-check-only\nCOLLABORATIVE_SERVER_SECRET=synthetic-check-only\n')
            (target / 'docker.env').write_text('')
            run('docker', 'compose', '--env-file', str(target / '.env'), '-f', str(target / 'compose.yaml'), 'config', '--quiet')
        api = temp / 'deployment/forum-api'
        config = json.loads(run('docker', 'compose', '--env-file', str(api / '.env'), '-f', str(api / 'compose.yaml'), '-f', str(api / 'sber-dns.override.yaml'), 'config', '--format', 'json'))
        assert config['services']['forum_api']['dns'] == ['172.16.160.1']
        outline = temp / 'deployment/vps/outline'
        config = json.loads(run('docker', 'compose', '--env-file', str(outline / '.env'), '-f', str(outline / 'compose.yaml'), '-f', str(outline / 'dev-landing-api.override.yaml'), 'config', '--format', 'json'))
        assert config['services']['dev_landing_auth']['environment']['FORUM_API_ORIGIN'] == 'http://forum_api:3001'
        pg = temp / 'deployment/pgadmin'
        config = json.loads(run('docker', 'compose', '-f', str(pg / 'compose.yaml'), 'config', '--format', 'json'))
        assert config['services']['pgadmin']['ports'][0]['host_ip'] == '127.0.0.1'
        assert config['services']['pgadmin']['environment']['PGADMIN_REPLACE_SERVERS_ON_STARTUP'] == 'False'
    # Adapt in a disposable network-none container. It neither starts Caddy
    # nor loads certificate secrets, active adapted configs or server services.
    source = ROOT / 'deployment/vps/outline/Caddyfile.example'
    adapted = json.loads(run('docker', 'run', '--rm', '--network', 'none', '--read-only', '-v', f'{source}:/candidate/Caddyfile:ro', CADDY, 'caddy', 'adapt', '--config', '/candidate/Caddyfile', '--adapter', 'caddyfile'))
    assert adapted['apps']['http']['servers']
    print(f'Operational sources: {count} provenance entries, 4 Compose owners, 2 overrides, Caddy adaptation, 8 HTML templates, administrative resource/import closure and Python/shell/Ruby/Node syntax passed')


if __name__ == '__main__':
    main()
