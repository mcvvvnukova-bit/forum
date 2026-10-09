#!/usr/bin/env python3
"""Manage repository-scoped CI on Docker Desktop; GitHub credentials stay on Mac."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import time

REPOSITORY = 'mcvvvnukova-bit/forum'
PROJECT = 'astforum-ci-local'
RUNNERS = {'runner1': 'astforum-mac-ci-01', 'runner2': 'astforum-mac-ci-02'}
STATE = Path.home() / 'Library/Application Support/AST Forum CI'
LABEL = 'ru.astforum.ci-local'
# These immutable references are the existing verification source pins.
IMAGES = [
    ('postgres@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2', 'linux/amd64'),
    ('python@sha256:2d9aefe2fef018a7eb2c13064c89c71929800fd2e5dccdbf52ea5da5bb8d929a', 'linux/arm64'),
    ('caddy@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d', 'linux/arm64'),
    ('openproject/openproject@sha256:8e49371d8d2aa5b92a40231687076fa3eaa2c98ff1f4f1789e1fe9da5fd838f9', 'linux/arm64'),
    ('caddy:2.10-alpine', 'linux/arm64'),
]


class Manager:
    def __init__(self, state_dir=STATE):
        self.state = Path(state_dir).expanduser().resolve()
        self.runtime = self.state / 'runtime'
        self.compose = ['docker', 'compose', '--project-name', PROJECT,
                        '--file', str(self.runtime / 'compose.yaml')]

    def run(self, argv, *, input=None):
        # Capture all command output. In particular config.sh/gh errors cannot echo tokens.
        result = subprocess.run(argv, input=input, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
        if result.returncode:
            raise RuntimeError(f'{Path(argv[0]).name} command failed (exit {result.returncode})')
        return result.stdout

    def copy_runtime(self):
        source = Path(__file__).resolve()
        deployment = source.parents[3] / 'deployment/ci-local'
        if source.parent == self.runtime:
            if not (self.runtime / 'compose.yaml').is_file():
                raise RuntimeError('Installed runtime is incomplete')
            return
        self.runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.state.chmod(0o700)
        self.runtime.chmod(0o700)
        for name in ['Dockerfile', 'compose.yaml', 'entrypoint.sh', 'job-started.sh', 'validate-job.py', 'README.md']:
            shutil.copyfile(deployment / name, self.runtime / name)
            (self.runtime / name).chmod(0o600)
        shutil.copyfile(source, self.runtime / 'manage.py')
        (self.runtime / 'manage.py').chmod(0o600)

    def start(self):
        if not (self.runtime / 'compose.yaml').is_file():
            raise RuntimeError('Run install from the repository first')
        self.run(self.compose + ['up', '-d', '--wait', '--wait-timeout', '180'])

    def stop(self):
        # Stop keeps containers, volumes, image layers and GitHub registrations intact.
        self.run(self.compose + ['stop', '--timeout', '30'])

    def registrations(self):
        data = self.run(['gh', 'api', '--paginate', '--slurp', f'repos/{REPOSITORY}/actions/runners?per_page=100'])
        return [runner for page in json.loads(data) for runner in page['runners']]

    def register_missing(self):
        remote = self.registrations()
        for service, name in RUNNERS.items():
            local = json.loads(self.run(self.compose + ['exec', '-T', service, 'python3', '-c',
                "import json,pathlib;p=pathlib.Path('/home/runner/.runner');print(p.read_text() if p.exists() else '{}')"]))
            matches = [runner for runner in remote if runner['name'] == name]
            if local:
                if len(matches) != 1 or matches[0]['id'] != local.get('agentId'):
                    raise RuntimeError(f'{name}: local/GitHub registration mismatch; inspect manually')
                continue
            if matches:
                raise RuntimeError(f'{name}: existing GitHub registration has no local state; inspect manually')
            token = self.run(['gh', 'api', '--method', 'POST',
                             f'repos/{REPOSITORY}/actions/runners/registration-token', '--jq', '.token']).strip()
            if not token:
                raise RuntimeError('Empty GitHub registration token')
            self.run(self.compose + ['exec', '-T', service, '/usr/local/bin/ci-local-entrypoint', 'register'],
                     input=token + '\n')
            token = None

    def install(self):
        self.copy_runtime()
        self.run(self.compose + ['build'])
        self.run(self.compose + ['stop', '--timeout', '30', 'runner1', 'runner2'])
        self.run(self.compose + ['up', '-d', '--wait', '--wait-timeout', '180', 'daemon'])
        self.warm()
        self.start()
        self.register_missing()

    def nested(self, *args):
        return self.compose + ['exec', '-T', 'daemon', 'docker', '-H', 'unix:///docker/docker.sock', *args]

    def image_present(self, argv, reference, platform):
        try:
            actual = self.run(argv + ['image', 'inspect', '--platform', platform, '--format', '{{.Os}}/{{.Architecture}}', reference]).strip()
            return actual == platform
        except RuntimeError:
            return False

    def import_image(self, reference, platform):
        # Save a real tag whose RepoDigest matches the pin. Anonymous digest saves
        # omit the repository name and cannot seed pull=never reference lookup.
        candidates = {'postgres': 'postgres:18-alpine', 'python': 'python:3.13-alpine',
                      'caddy': 'caddy:2.10-alpine', 'openproject/openproject': 'openproject/openproject:17.8.0'}
        tag = candidates.get(reference.split('@')[0], reference)
        if not self.image_present(['docker'], tag, platform):
            return
        if '@' in reference:
            digests = json.loads(self.run(['docker', 'image', 'inspect', '--platform', platform,
                                          '--format', '{{json .RepoDigests}}', tag]) or '[]')
            if reference not in digests:
                return
        # Prefer the full index: selected-platform archives omit its original digest.
        # A partially cached multiarch index may fail export despite the requested
        # platform being present. Retry only that platform, then let warm resolve
        # the authoritative reference (or propagate its pull/daemon failure).
        for selection in [[], ['--platform', platform]]:
            with tempfile_stream() as error:
                producer = subprocess.Popen(['docker', 'image', 'save', *selection, tag],
                                            stdout=subprocess.PIPE, stderr=error)
                try:
                    consumer = subprocess.run(self.nested('image', 'load'), stdin=producer.stdout,
                                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                finally:
                    producer.stdout.close()
                    producer.wait()
                if not producer.returncode and not consumer.returncode:
                    return

    def warm(self):
        for reference, platform in IMAGES:
            if not self.image_present(self.nested(), reference, platform):
                if self.image_present(['docker'], reference, platform):
                    self.import_image(reference, platform)
                # Docker save/load may omit RepoDigests. Resolve the authoritative ref explicitly.
                if not self.image_present(self.nested(), reference, platform):
                    self.run(self.nested('pull', '--platform', platform, reference))
            if not self.image_present(self.nested(), reference, platform):
                raise RuntimeError('Nested image reference/platform mismatch')
            self.run(self.nested('run', '--rm', '--pull=never', '--network', 'none',
                                 '--platform', platform, '--entrypoint', '/bin/sh', reference, '-c', 'true'))
            print(json.dumps({'image': reference, 'platform': platform, 'ready': True}))

    def status(self):
        raw = self.run(self.compose + ['ps', '--all', '--format', 'json']).strip()
        services = json.loads(raw) if raw.startswith('[') else [json.loads(line) for line in raw.splitlines()]
        # Compose versions can return an array or one JSON object per line.
        if isinstance(services, dict):
            services = [services]
        remote = self.registrations()
        return {'project': PROJECT,
                'services': [{'service': row.get('Service'), 'state': row.get('State'),
                              'health': row.get('Health')} for row in services],
                'runners': [{'name': row['name'], 'status': row['status'], 'busy': row['busy']}
                            for row in remote if row['name'] in RUNNERS.values()]}

    def login_start(self):
        self.run(['docker', 'desktop', 'start', '--timeout', '180'])
        deadline = time.monotonic() + 180
        while True:
            try:
                self.run(['docker', 'info'])
                break
            except RuntimeError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Docker Desktop did not become ready')
                time.sleep(3)
        self.start()

    def autostart(self):
        if not (self.runtime / 'manage.py').is_file():
            raise RuntimeError('Install the copied runtime first')
        path = Path.home() / 'Library/LaunchAgents' / f'{LABEL}.plist'
        path.parent.mkdir(parents=True, exist_ok=True)
        executable = shutil.which('python3')
        docker = shutil.which('docker')
        if not executable or not docker:
            raise RuntimeError('Python and Docker must be installed')
        path.write_bytes(plistlib.dumps({
            'Label': LABEL,
            'ProgramArguments': [executable, str(self.runtime / 'manage.py'),
                                 'login-start', '--state-dir', str(self.state)],
            'RunAtLoad': True,
            'EnvironmentVariables': {'PATH': f'{Path(docker).parent}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin'},
            'StandardOutPath': str(self.state / 'launch.log'),
            'StandardErrorPath': str(self.state / 'launch-error.log'),
        }))
        path.chmod(0o600)
        domain = f'gui/{os.getuid()}'
        # Updating the same label is idempotent; bootout failure means not previously loaded.
        subprocess.run(['launchctl', 'bootout', domain, str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.run(['launchctl', 'bootstrap', domain, str(path)])


def tempfile_stream():
    import tempfile
    return tempfile.TemporaryFile()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['install', 'start', 'stop', 'status', 'warm', 'autostart', 'login-start'])
    parser.add_argument('--state-dir', type=Path, default=STATE)
    args = parser.parse_args()
    manager = Manager(args.state_dir)
    try:
        result = getattr(manager, args.command.replace('-', '_'))()
        if result is not None:
            print(json.dumps(result))
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(f'Local CI: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
