"""Focused local CI regression tests; runtime activation belongs to the operator."""
import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def module():
    spec = importlib.util.spec_from_file_location('local_ci', ROOT / 'scripts/deployment/ci-local/manage.py')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class Routing(unittest.TestCase):
    def test_only_docker_jobs_use_trusted_dynamic_routing(self):
        workflow = (ROOT / '.github/workflows/quality.yml').read_text()
        jobs = {name: re.search(r'^    runs-on: (.+)$', block, re.M)[1]
                for name, block in re.findall(r'^  ([\w-]+):\n(.*?)(?=^  [\w-]+:|\Z)', workflow.split('jobs:\n', 1)[1], re.M | re.S)}
        for name in ['api', 'database', 'operational', 'web-release']:
            expression = jobs[name]
            self.assertIn('fromJSON(', expression)
            self.assertIn('ASTFORUM_CI_DOCKER_RUNNERS', expression)
            self.assertIn("github.event_name != 'pull_request'", expression)
            self.assertIn('github.event.pull_request.head.repo.full_name == github.repository', expression)
            self.assertIn('["ubuntu-24.04"]', expression)
        for name in ['changes', 'layout', 'frontend', 'composition', 'publishers', 'profile', 'quality']:
            self.assertEqual(jobs[name], 'ubuntu-24.04')




class ManagerBehavior(unittest.TestCase):
    def setUp(self):
        self.m = module()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.manager = self.m.Manager(Path(self.temp.name) / 'state')

    def test_install_copies_complete_runtime_and_seeds_before_registration(self):
        self.manager.copy_runtime()
        self.assertEqual(self.manager.state.stat().st_mode & 0o777, 0o700)
        for name in ['manage.py', 'Dockerfile', 'compose.yaml', 'entrypoint.sh', 'job-started.sh', 'validate-job.py']:
            self.assertTrue((self.manager.runtime / name).is_file())
        with patch.object(self.manager, 'run') as run, patch.object(self.manager, 'warm') as warm, patch.object(self.manager, 'register_missing') as register:
            calls = []
            run.side_effect = lambda *a, **k: calls.append('run')
            warm.side_effect = lambda: calls.append('warm')
            register.side_effect = lambda: calls.append('register')
            self.manager.install()
        self.assertEqual(calls, ['run', 'run', 'run', 'warm', 'run', 'register'])

    def test_stop_restart_keep_volumes_and_do_not_register(self):
        self.manager.copy_runtime()
        with patch.object(self.manager, 'run', return_value='') as run, patch.object(self.manager, 'register_missing') as register:
            self.manager.stop()
            self.manager.start()
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(commands[0][-3:], ['stop', '--timeout', '30'])
        self.assertIn('up', commands[1])
        self.assertNotIn('down', str(commands))
        self.assertNotIn('--volumes', str(commands))
        register.assert_not_called()

    def test_registration_token_is_only_stdin_and_repeated_registration_is_noop(self):
        token = 'fake-sensitive-registration'
        remote = []
        configs = {}
        calls = []
        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            if argv[:2] == ['gh', 'api']:
                self.assertIn('registration-token', argv[-3])
                return token + '\n'
            service = argv[argv.index('-T') + 1]
            if argv[-1] == 'register':
                self.assertEqual(kwargs, {'input': token + '\n'})
                identifier = len(configs) + 1
                configs[service] = {'agentId': identifier}
                remote.append({'name': self.m.RUNNERS[service], 'id': identifier})
                return ''
            return json.dumps(configs.get(service, {}))
        with patch.object(self.manager, 'registrations', side_effect=lambda: remote.copy()), patch.object(self.manager, 'run', side_effect=run):
            self.manager.register_missing()
            initial = len(calls)
            self.manager.register_missing()
        self.assertEqual(len(calls) - initial, 2)
        self.assertEqual(sum(argv[-1] == 'register' for argv, _ in calls), 2)
        self.assertTrue(all(token not in str(argv) for argv, _ in calls))

    def test_missing_local_state_never_replaces_existing_registration(self):
        with patch.object(self.manager, 'registrations', return_value=[{'name': 'astforum-mac-ci-01', 'id': 1}]), patch.object(self.manager, 'run', return_value='{}'):
            with self.assertRaisesRegex(RuntimeError, 'no local state'):
                self.manager.register_missing()

    def test_secret_bearing_subprocess_errors_are_redacted(self):
        completed = subprocess.CompletedProcess(['gh'], 1, 'secret token', 'secret token')
        with patch.object(self.m.subprocess, 'run', return_value=completed):
            with self.assertRaisesRegex(RuntimeError, '^gh command failed \\(exit 1\\)$'):
                self.manager.run(['gh', 'api'])

    def test_status_returns_only_sanitized_fields_and_accepts_ndjson(self):
        rows = [{'Service': 'daemon', 'State': 'running', 'Health': 'healthy', 'Command': 'secret'}, {'Service': 'runner1', 'State': 'running'}]
        with patch.object(self.manager, 'run', return_value='\n'.join(json.dumps(row) for row in rows)), patch.object(self.manager, 'registrations', return_value=[{'name': 'astforum-mac-ci-01', 'status': 'online', 'busy': False, 'token': 'secret'}]):
            result = self.manager.status()
        self.assertNotIn('secret', json.dumps(result))
        self.assertEqual(len(result['services']), 2)

    def test_warm_checks_platform_and_pull_never_before_ready(self):
        with patch.object(self.manager, 'image_present', return_value=True) as present, patch.object(self.manager, 'run', return_value='') as run:
            self.manager.warm()
        self.assertEqual(present.call_count, 10)
        for call in run.call_args_list:
            self.assertIn('--pull=never', call.args[0])
            self.assertIn('none', call.args[0])
        self.assertEqual(run.call_count, 5)


class IsolationAndTrust(unittest.TestCase):
    def test_compose_has_only_named_mounts_and_one_privileged_daemon(self):
        result = subprocess.run(['docker', 'compose', '-f', str(ROOT/'deployment/ci-local/compose.yaml'), 'config', '--format', 'json'], capture_output=True, text=True, check=True)
        config = json.loads(result.stdout)
        self.assertEqual(config['name'], 'astforum-ci-local')
        for name, service in config['services'].items():
            self.assertEqual(service.get('privileged', False), name == 'daemon')
            self.assertNotIn('ports', service)
            for mount in service['volumes']:
                self.assertEqual(mount['type'], 'volume')
                self.assertNotEqual(mount['target'], '/var/run/docker.sock')
            if name != 'daemon':
                self.assertEqual(service['network_mode'], 'service:daemon')
                self.assertEqual(service['environment']['DOCKER_HOST'], 'unix:///docker/docker.sock')
                self.assertEqual(service['environment']['ImageOS'], 'ubuntu24')
                self.assertEqual(service['environment']['TMPDIR'], '/ci/'+service['environment']['RUNNER_SLOT']+'/tmp')
                self.assertTrue(all('TOKEN' not in key for key in service['environment']))
                self.assertEqual(service['environment']['ACTIONS_RUNNER_HOOK_JOB_STARTED'], '/opt/astforum-ci/job-started.sh')
        self.assertEqual(len(config['volumes']), 7)
        self.assertEqual(sum(float(service['cpus']) for service in config['services'].values()), 4)
        self.assertEqual(sum(int(service['mem_limit']) for service in config['services'].values()), 3*1024**3)
        self.assertEqual({config['services'][name]['environment']['FORUM_WEB_E2E_PORT'] for name in ['runner1','runner2']}, {'5297','5298'})

    def test_baked_hook_accepts_only_owned_well_formed_events(self):
        repo = 'mcvvvnukova-bit/forum'
        cases = [('push', {'repository': {'full_name': repo}}, True),
                 ('workflow_dispatch', {'repository': {'full_name': repo}}, True),
                 ('pull_request', {'pull_request': {'head': {'repo': {'full_name': repo}}, 'base': {'repo': {'full_name': repo}}}}, True),
                 ('pull_request', {'pull_request': {'head': {'repo': {'full_name': 'fork/forum'}}, 'base': {'repo': {'full_name': repo}}}}, False),
                 ('push', {'repository': {'full_name': 'fork/forum'}}, False),
                 ('pull_request', {'pull_request': {'head': None}}, False),
                 ('schedule', {'repository': {'full_name': repo}}, False),
                 ('push', {}, False), ('push', [], False)]
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory)/'event.json'
            for name, payload, accepted in cases:
                event.write_text(json.dumps(payload))
                result = subprocess.run(['python3', str(ROOT/'deployment/ci-local/validate-job.py')], env={**os.environ, 'GITHUB_EVENT_PATH': str(event), 'GITHUB_EVENT_NAME': name, 'GITHUB_REPOSITORY': repo}, capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, accepted, (name,payload,result.stderr))
            event.write_text('{malformed-secret')
            result = subprocess.run(['python3', str(ROOT/'deployment/ci-local/validate-job.py')], env={**os.environ, 'GITHUB_EVENT_PATH': str(event), 'GITHUB_EVENT_NAME': 'push', 'GITHUB_REPOSITORY': repo}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('secret', result.stderr)


class RoutingEvaluation(unittest.TestCase):
    def test_actual_workflow_expression_defaults_and_fork_fallback(self):
        workflow = (ROOT/'.github/workflows/quality.yml').read_text()
        expression = re.search(r'runs-on: \$\{\{ (.+) \}\}', workflow)[1]
        labels = ['self-hosted','Linux','ARM64','astforum-local-ci']
        for name, head, variable, expected in [('push', None, '', ['ubuntu-24.04']),
               ('workflow_dispatch', None, json.dumps(labels), labels),
               ('push', None, json.dumps(labels), labels),
               ('pull_request', 'mcvvvnukova-bit/forum', json.dumps(labels), labels),
               ('pull_request', 'fork/forum', json.dumps(labels), ['ubuntu-24.04'])]:
            context = {'event_name':name, 'repository':'mcvvvnukova-bit/forum', 'event':{'pull_request':{'head':{'repo':{'full_name':head}}}}}
            script = 'const github='+json.dumps(context)+';const vars='+json.dumps({'ASTFORUM_CI_DOCKER_RUNNERS':variable})+';const fromJSON=JSON.parse;console.log(JSON.stringify('+expression+'))'
            result = subprocess.run(['node','-e',script], capture_output=True,text=True,check=True)
            self.assertEqual(json.loads(result.stdout), expected)


class WebPort(unittest.TestCase):
    def test_config_default_override_and_invalid_port(self):
        source = (ROOT/'tests/e2e/public-site.config.ts').read_text()
        source = source.replace("import {defineConfig} from '@playwright/test'", '')
        source = source.replace('export default defineConfig(', 'console.log(JSON.stringify(').strip() + ')'
        for value, expected in [(None,5297),('5298',5298),('0',None),('-1',None),('65536',None),('5297;exec',None),('',None)]:
            env = dict(os.environ)
            env.pop('FORUM_WEB_E2E_PORT',None)
            if value is not None: env['FORUM_WEB_E2E_PORT']=value
            result = subprocess.run(['node','--input-type=module','-e',source],env=env,capture_output=True,text=True)
            if expected is None:
                self.assertNotEqual(result.returncode,0)
            else:
                self.assertEqual(result.returncode,0,result.stderr)
                config=json.loads(result.stdout)
                self.assertEqual(config['use']['baseURL'],f'http://127.0.0.1:{expected}')
                self.assertEqual(config['webServer']['url'],config['use']['baseURL'])

    def test_real_server_uses_same_override_and_rejects_invalid_input(self):
        import socket
        import time
        from urllib.request import urlopen
        with tempfile.TemporaryDirectory() as directory:
            Path(directory,'index.html').write_text('port-test')
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
            env={**os.environ,'FORUM_WEB_SITE':directory,'FORUM_WEB_E2E_PORT':str(port)}
            server=subprocess.Popen(['node',str(ROOT/'tests/e2e/serve-public-site.mjs')],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                for attempt in range(50):
                    try:
                        with urlopen(f'http://127.0.0.1:{port}/',timeout=1) as response:
                            self.assertEqual(response.read(),b'port-test')
                        break
                    except OSError:
                        time.sleep(.02)
                else: self.fail('server did not start')
            finally:
                server.terminate();server.communicate(timeout=5)
            env['FORUM_WEB_E2E_PORT']='65536'
            result=subprocess.run(['node',str(ROOT/'tests/e2e/serve-public-site.mjs')],env=env,capture_output=True,text=True,timeout=5)
            self.assertNotEqual(result.returncode,0)


class Ownership(unittest.TestCase):
    def fixture(self, directory):
        import shutil
        destination=Path(directory)
        files=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
        for name in filter(None,files):
            path=destination/name;path.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(ROOT/name,path)
            shutil.copymode(ROOT/name,path)
        return destination

    def provenance(self, root):
        spec=importlib.util.spec_from_file_location('ownership_checker',root/'scripts/verification/check-operational-sources.py')
        checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
        checker.ROOT=root
        checker.verify_provenance()

    def test_provenance_rejects_exact_layer_and_source_tampering(self):
        for mutation in ['hash','pin','scope','mode','path','duplicate','new-hash','new-path','missing','source','symlink','history']:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root=self.fixture(directory)
                self.provenance(root)
                file=root/'artifacts/repository-audits/proj-168-local-ci-ownership.json'
                receipt=json.loads(file.read_text())
                if mutation=='hash': receipt['changes'][0]['candidateSha256']='0'*64
                elif mutation=='pin': receipt['changes'][0]['previousSha256']='0'*64
                elif mutation=='scope': receipt['changes'][0]['previousCandidatePath']='package.json'
                elif mutation=='mode': receipt['changes'][0]['candidateMode']='100755'
                elif mutation=='path': receipt['changes'][0]['candidatePath']='../package.json'
                elif mutation=='duplicate': receipt['changes'].append(receipt['changes'][0])
                elif mutation=='new-hash': receipt['newFiles'][0]['sha256']='0'*64
                elif mutation=='new-path': receipt['newFiles'][0]['path']='access.private.json'
                elif mutation=='missing': receipt['newFiles'].pop()
                elif mutation=='source': (root/'deployment/ci-local/compose.yaml').write_text('unexpected drift')
                elif mutation=='symlink':
                    source=root/'deployment/ci-local/Dockerfile';data=source.read_bytes();source.unlink();outside=root/'outside';outside.write_bytes(data);source.symlink_to(outside)
                elif mutation=='history':
                    old=root/'artifacts/repository-audits/proj-164-ci-ownership.json';r=json.loads(old.read_text());r['changes'][0]['candidateSha256']='0'*64;old.write_text(json.dumps(r))
                file.write_text(json.dumps(receipt))
                with self.assertRaises(AssertionError): self.provenance(root)


class PersistentValidation(unittest.TestCase):
    def test_new_suite_remains_in_existing_workflow_gate(self):
        workflow=(ROOT/'.github/workflows/quality.yml').read_text()
        step=workflow.split('      - name: Verification and CI regressions',1)[1].split('      - name:',1)[0]
        self.assertIn('node --test scripts/verification/checks.test.mjs scripts/verification/ci-optimization.test.mjs',step)
        self.assertIn('python3 -m unittest discover -s scripts/verification -p test_local_ci.py -v',step)

    def test_actual_database_shell_skips_only_correct_platform_and_pulls_on_miss(self):
        workflow=(ROOT/'.github/workflows/quality.yml').read_text()
        shell=workflow.split('      - name: Network-isolated disposable PostgreSQL ACL regressions',1)[1].split('          python3 -m unittest',1)[0].split('        run: |\n',1)[1]
        with tempfile.TemporaryDirectory() as directory:
            docker=Path(directory)/'docker';calls=Path(directory)/'calls'
            docker.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMANDS"\nif [ "$1" = image ]; then printf "%s\\n" "$FAKE_ARCH"; exit "$FAKE_RESULT"; fi\n')
            docker.chmod(0o755)
            for architecture, status, expected in [('linux/amd64','0',False),('linux/arm64','0',True),('','1',True)]:
                calls.write_text('')
                env={**os.environ,'PATH':directory+os.pathsep+os.environ['PATH'],'COMMANDS':str(calls),'FAKE_ARCH':architecture,'FAKE_RESULT':status,'FORUM_TEST_POSTGRES_IMAGE':'postgres@sha256:test'}
                result=subprocess.run(['bash','-e','-c',shell],env=env,capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual('pull --platform linux/amd64 postgres@sha256:test' in calls.read_text(),expected)

    def test_autostart_uses_private_copied_runtime_and_no_credentials(self):
        import plistlib
        m=module()
        with tempfile.TemporaryDirectory() as directory:
            manager=m.Manager(Path(directory)/'state');manager.copy_runtime()
            with patch.object(m.Path,'home',return_value=Path(directory)), patch.object(m.shutil,'which',side_effect=lambda name:'/usr/local/bin/'+name), patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'','')):
                manager.autostart()
            path=Path(directory)/'Library/LaunchAgents/ru.astforum.ci-local.plist'
            config=plistlib.loads(path.read_bytes())
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertIn(str(manager.runtime/'manage.py'),config['ProgramArguments'])
            self.assertIn('login-start',config['ProgramArguments'])
            self.assertNotIn('token',json.dumps(config).lower())
            self.assertNotIn('gh',config['ProgramArguments'])

    def test_platform_mismatch_is_absent(self):
        m=module();manager=m.Manager('/tmp/proj168-test-state')
        with patch.object(manager,'run',return_value='linux/arm64'):
            self.assertFalse(manager.image_present(['docker'],'postgres@sha256:test','linux/amd64'))


if __name__ == '__main__':
    unittest.main()
