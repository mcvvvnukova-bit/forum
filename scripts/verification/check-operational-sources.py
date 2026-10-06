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
            path = ROOT / candidate
            assert path.is_file() and not path.is_symlink(), candidate
            data = path.read_bytes()
            assert hashlib.sha256(data).hexdigest() == file['candidateSha256'], candidate
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            assert blob == file['candidateGitBlob'], candidate
            mode = '100755' if path.stat().st_mode & 0o111 else '100644'
            assert mode == file['candidateMode'], candidate
            accepted += 1
    assert accepted > 0
    parity = json.loads((ROOT / 'artifacts/repository-audits/task-5-source-parity.json').read_text())
    for file in parity['files']:
        path = ROOT / file['newPath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == file['newSha256'], file['newPath']
        mode = '100755' if path.stat().st_mode & 0o111 else '100644'
        assert mode == file['newMode'], file['newPath']
        if file['unchanged']:
            assert file['previousSha256'] == file['newSha256'] and file['previousMode'] == file['newMode']
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
