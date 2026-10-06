"""Run the configuration flow in temporary paths and ACL checks on PostgreSQL 18.6.

The command harness models pgAdmin recreation/registrations, not its web server.
All database SQL is executed inside a disposable network-none Docker container.
Run: python3 -m unittest discover -s deployment/forum-db/tests -p 'test_*.py' -v
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'deployment/forum-db/configure_forum_app_role.sh'
GRANTS = ROOT / 'deployment/forum-api/grant-runtime.sql'
DOCKER = shutil.which('docker')
IMAGE = os.environ.get('FORUM_TEST_POSTGRES_IMAGE', 'postgres:18-alpine')

HARNESS = r'''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
args = sys.argv[1:]
command = pathlib.Path(sys.argv[0]).name
if command == 'id': print('0'); sys.exit()
if command == 'chown': sys.exit()
if command == 'stat':
    st = pathlib.Path(args[-1]).stat()
    print({'%u': st.st_uid, '%g': st.st_gid, '%a': format(st.st_mode & 0o777, 'o')}[args[1]])
    sys.exit()
if command == 'install':
    filtered = []
    while args:
        item = args.pop(0)
        if item in ('-o', '-g'): args.pop(0)
        else: filtered.append(item)
    sys.exit(subprocess.call([os.environ['REAL_INSTALL'], *filtered]))
payload = sys.stdin.read() if not ('ps' in args or 'inspect' in args or 'config' in args or 'up' in args or 'cp' in args) else ''
with (root / 'commands.jsonl').open('a') as log:
    # Password values passed to psql must never enter the harness log.
    safe = ['app_password=<redacted>' if a.startswith('app_password=') else a for a in args]
    log.write(json.dumps({'args': safe, 'stdin': payload}) + '\n')
if args[0] == 'cp': pathlib.Path(args[-1]).write_bytes(b'synthetic sqlite backup'); sys.exit()
if args[0] == 'inspect':
    name = {'postgres-old': 'postgres-data', 'pgadmin-old': 'old-data', 'pgadmin-new': 'new-data'}[args[1]]
    print(root / name); sys.exit()
assert args[:2] == ['compose', '-f'], args
args = args[3:]
if args[0] == 'config': sys.exit()
if args[0] == 'ps':
    if args[-1] == 'postgres': print('postgres-old')
    elif not (root / 'recreated').exists(): print('pgadmin-old')
    elif not os.environ.get('MISSING_RECREATED_ID'): print('pgadmin-new')
    sys.exit()
if args[0] == 'up': (root / 'recreated').touch(); sys.exit()
assert args[0] == 'exec', args
args = args[1:]
while args[0].startswith('-'):
    flag = args.pop(0)
    if flag == '--user': args.pop(0)
service = args.pop(0)
if service == 'postgres':
    query = args[-1] if '-Atqc' in args else payload
    if query == 'SHOW hba_file;': print('/var/lib/postgresql/pg_hba.conf'); sys.exit()
    if 'pg_hba_file_rules' in query:
        if '-Atqc' in args: print('0')
        sys.exit()
    cmd = [os.environ['REAL_DOCKER'], 'exec', '-i', os.environ['TEST_CONTAINER'], *args]
    sys.exit(subprocess.run(cmd, input=payload, text=True).returncode)
assert service == 'pgadmin'
if args[0] == 'wget': print('PING'); sys.exit()
if args[0] == 'rm': sys.exit()
if args[0] == 'sh':
    # Execute the actual positive smoke SQL; pgAdmin's network/HBA connection
    # rejection checks are outside this command/filesystem harness.
    smoke = payload.split("<<'SQL'\n", 1)[1].split('\nSQL\n', 1)[0]
    cmd = [os.environ['REAL_DOCKER'], 'exec', '-i', os.environ['TEST_CONTAINER'],
           'psql', '-X', '-U', args[2], '-d', args[3] if len(args) > 3 else 'forum', '-v', 'ON_ERROR_STOP=1']
    sys.exit(subprocess.run(cmd, input=smoke, text=True).returncode)
assert args[0] == '/venv/bin/python3', args
if 'setup.py' in args[1]:
    action = args[2]
    if action == 'get-users': print(json.dumps({'email': args[args.index('--username') + 1]}))
    elif action == 'load-servers':
        user = args[args.index('--user') + 1]
        (root / 'new-data' / (user + '.json')).write_text((root / 'pgadmin/servers.json').read_text())
    elif action == 'dump-servers':
        user = args[args.index('--user') + 1]
        (root / pathlib.Path(args[3]).name).write_text((root / 'new-data' / (user + '.json')).read_text())
    else: raise AssertionError(args)
elif 'sqlite3' not in payload:
    translated = [str(root / pathlib.Path(a).name) if a.startswith('/tmp/') else a for a in args[2:]]
    sys.exit(subprocess.run([sys.executable, '-', *translated], input=payload, text=True).returncode)
'''


class ConfigureRoleContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not DOCKER:
            raise RuntimeError('Docker is required; these ACL regressions must not be skipped')
        cls.container = 'forum-role-contract-' + uuid.uuid4().hex[:12]
        subprocess.run([DOCKER, 'run', '-d', '--rm', '--network', 'none',
                        '--platform', 'linux/amd64', '--name', cls.container,
                        '-e', 'POSTGRES_USER=outline', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
                        IMAGE], check=True, capture_output=True, text=True)
        try:
            subprocess.run([DOCKER, 'exec', cls.container, 'sh', '-c',
                            'for n in $(seq 1 60); do [ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U outline >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'],
                           check=True, capture_output=True, text=True, timeout=65)
            version = subprocess.check_output([DOCKER, 'exec', cls.container, 'postgres', '--version'], text=True)
            if '18.6' not in version:
                raise RuntimeError('Require PostgreSQL 18.6, got ' + version)
            print(version.strip())
            cls.sql('CREATE ROLE forum_app_role NOLOGIN; CREATE ROLE forum_app LOGIN IN ROLE forum_app_role; '
                    'CREATE ROLE forum_sber_sandbox_app LOGIN; CREATE ROLE unrelated_role NOLOGIN;', 'postgres')
        except BaseException:
            subprocess.run([DOCKER, 'rm', '-f', cls.container], capture_output=True)
            raise

    @classmethod
    def tearDownClass(cls):
        subprocess.run([DOCKER, 'rm', '-f', cls.container], check=True, capture_output=True)

    @classmethod
    def sql(cls, text, database='forum', check=True, role='outline'):
        result = subprocess.run([DOCKER, 'exec', '-i', cls.container, 'psql', '-X',
                                 '-U', role, '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'],
                                input=text, text=True, capture_output=True)
        if check and result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        return result

    def setUp(self):
        self.sql('DROP DATABASE IF EXISTS forum WITH (FORCE);', 'postgres')
        self.sql('CREATE DATABASE forum OWNER outline;', 'postgres')
        migrations = ROOT / 'apps/api/migrations'
        self.sql((migrations / '001_sber_identity.sql').read_text())
        self.sql("CREATE TABLE iam.schema_migrations(name text PRIMARY KEY);"
                 "INSERT INTO iam.schema_migrations VALUES ('001_sber_identity'),('002_profiles');")
        self.sql((migrations / '002_profiles.sql').read_text())
        self.sql((migrations / '003_public_schema.sql').read_text())
        self.sql("INSERT INTO public.schema_migrations VALUES ('003_public_schema');"
                 "CREATE TABLE public.unrelated_data(id bigserial PRIMARY KEY);"
                 "GRANT SELECT ON public.unrelated_data TO unrelated_role;"
                 "CREATE SCHEMA other; CREATE TABLE other.keep_access(id int);"
                 "GRANT USAGE ON SCHEMA other TO forum_app_role;"
                 "GRANT SELECT ON other.keep_access TO forum_app_role;"
                 "GRANT ALL ON ALL TABLES IN SCHEMA public TO forum_app_role;"
                 "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO forum_app_role;"
                 "GRANT UPDATE(sber_profile) ON public.persons TO forum_app_role;"
                 "GRANT UPDATE(data) ON public.audit_events TO forum_app_role;"
                 "ALTER DEFAULT PRIVILEGES FOR ROLE unrelated_role IN SCHEMA public GRANT ALL ON TABLES TO forum_app_role;"
                 "ALTER DEFAULT PRIVILEGES FOR ROLE outline IN SCHEMA other GRANT SELECT ON TABLES TO forum_app_role;"
                 "ALTER DEFAULT PRIVILEGES FOR ROLE outline IN SCHEMA public GRANT ALL ON TABLES TO forum_app_role;"
                 "ALTER DEFAULT PRIVILEGES FOR ROLE outline IN SCHEMA public GRANT ALL ON SEQUENCES TO forum_app_role;")
        self.temp = tempfile.TemporaryDirectory(prefix='forum-role-contract-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        for directory in ['bin', 'pgadmin/secrets', 'postgres-data', 'old-data', 'new-data']:
            (self.path / directory).mkdir(parents=True)
        (self.path / 'outline.yaml').write_text('services: {}\n')
        (self.path / 'pgadmin.yaml').write_text('services:\n  pgadmin:\n    environment:\n      PGPASS_FILE: /run/secrets/outline_pgpass\n')
        (self.path / 'pgadmin/servers.json').write_text(json.dumps({'Servers': {'1': {'Name': 'Unrelated server'}}}))
        (self.path / 'pgadmin/secrets/outline_pgpass').write_text('postgres:5432:*:outline:disposable\n')
        (self.path / 'postgres-data/pg_hba.conf').write_text('local all all trust\n')
        for command in ['docker', 'id', 'chown', 'stat', 'install']:
            file = self.path / 'bin' / command
            file.write_text(HARNESS)
            file.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(self.path / 'bin') + ':' + os.environ['PATH'],
                    'FIXTURE_ROOT': str(self.path), 'REAL_DOCKER': DOCKER,
                    'REAL_INSTALL': shutil.which('install'), 'TEST_CONTAINER': self.container,
                    'OUTLINE_COMPOSE': str(self.path / 'outline.yaml'),
                    'PGADMIN_COMPOSE': str(self.path / 'pgadmin.yaml'),
                    'PGADMIN_DIR': str(self.path / 'pgadmin'), 'BACKUP_ROOT': str(self.path / 'backups'),
                    'PGADMIN_WAIT_SECONDS': '1', 'PGADMIN_USERS': 'admin@example.invalid ceo@example.invalid'}

    def configure(self, **env):
        return subprocess.run(['bash', str(SCRIPT)], env={**self.env, **env},
                              text=True, capture_output=True, timeout=60)

    def assert_grants(self):
        expected = {
            'users': {'SELECT', 'INSERT', 'UPDATE'}, 'external_identities': {'SELECT', 'INSERT', 'UPDATE'},
            'persons': {'SELECT', 'INSERT', 'UPDATE'}, 'organizations': {'SELECT', 'INSERT', 'UPDATE'},
            'participants': {'SELECT', 'INSERT', 'UPDATE'}, 'participant_memberships': {'SELECT', 'INSERT', 'UPDATE'},
            'sessions': {'SELECT', 'INSERT', 'UPDATE', 'DELETE'},
            'authorization_attempts': {'SELECT', 'INSERT', 'UPDATE', 'DELETE'},
            'role_assignments': {'SELECT', 'INSERT', 'DELETE'},
            'audit_events': {'SELECT', 'INSERT'}, 'outbox_events': {'SELECT', 'INSERT'},
            'schema_migrations': set(), 'unrelated_data': set(),
        }
        for table, allowed in expected.items():
            for privilege in ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']:
                value = self.sql(f"SELECT has_table_privilege('forum_app','public.{table}','{privilege}');").stdout.strip()
                self.assertEqual(value, 't' if privilege in allowed else 'f', f'{table}/{privilege}')
        for privilege in ['USAGE', 'SELECT', 'UPDATE']:
            value = self.sql(f"SELECT has_sequence_privilege('forum_app','public.outbox_events_sequence_seq','{privilege}');").stdout.strip()
            self.assertEqual(value, 'f' if privilege == 'UPDATE' else 't', 'outbox sequence/' + privilege)
        self.assertEqual(self.sql("SELECT has_sequence_privilege('forum_app','public.unrelated_data_id_seq','USAGE');").stdout.strip(), 'f')
        self.assertEqual(self.sql("SELECT has_table_privilege('unrelated_role','public.unrelated_data','SELECT') AND has_table_privilege('forum_app','other.keep_access','SELECT');").stdout.strip(), 't')
        self.assertEqual(self.sql("SELECT has_column_privilege('forum_app','public.audit_events','data','UPDATE');").stdout.strip(), 'f')

    def test_repeated_configuration_reconciles_real_acl_and_future_objects(self):
        for _ in range(2):
            result = self.configure()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assert_grants()
        self.sql('CREATE TABLE public.future_data(id bigserial PRIMARY KEY);')
        self.assertEqual(self.sql("SELECT has_table_privilege('forum_app','public.future_data','SELECT,INSERT,UPDATE,DELETE') OR has_sequence_privilege('forum_app','public.future_data_id_seq','USAGE,SELECT,UPDATE');").stdout.strip(), 'f')
        self.assertEqual(self.sql("SELECT count(*) FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a WHERE d.defaclnamespace='public'::regnamespace AND d.defaclobjtype IN ('r','S') AND a.grantee='forum_app_role'::regrole;").stdout.strip(), '0')
        self.sql('CREATE TABLE other.future_keep_access(id int);')
        self.assertEqual(self.sql("SELECT has_table_privilege('forum_app','other.future_keep_access','SELECT');").stdout.strip(), 't')
        self.sql('DROP SCHEMA other CASCADE;')
        self.sql((ROOT / 'deployment/forum-db/tests/public-schema.sql').read_text())
        self.sql((ROOT / 'deployment/forum-db/tests/profiles.sql').read_text(), role='forum_app')
        for statement in ['DELETE FROM public.persons', 'UPDATE public.audit_events SET action=action',
                          'DELETE FROM public.outbox_events', 'UPDATE public.role_assignments SET role=role',
                          "INSERT INTO public.schema_migrations VALUES ('forbidden')"]:
            failure = self.sql(statement, role='forum_app', check=False)
            self.assertNotEqual(failure.returncode, 0, statement)
            self.assertIn('permission denied', failure.stderr, failure.stderr)
        self.sql("BEGIN; INSERT INTO public.audit_events(id,actor_user_id,action,data) VALUES ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002','test','{}'); INSERT INTO public.outbox_events(event_id,aggregate_type,aggregate_id,event_type,payload) VALUES ('f0000000-0000-4000-8000-000000000003','test','f0000000-0000-4000-8000-000000000002','test','{}'); ROLLBACK;", role='forum_app')

    def test_recreated_pgadmin_id_controls_passfiles_and_registration(self):
        result = self.configure()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        records = [json.loads(line) for line in (self.path / 'commands.jsonl').read_text().splitlines()]
        mounts = [r['args'][1] for r in records if r['args'][0] == 'inspect' and r['args'][1].startswith('pgadmin')]
        self.assertEqual(mounts, ['pgadmin-new', 'pgadmin-new'])
        for user in self.env['PGADMIN_USERS'].split():
            storage = user.replace('@', '_')
            passfile = self.path / 'new-data/storage' / storage / 'forum_app.pgpass'
            self.assertTrue(passfile.is_file(), str(passfile))
            self.assertEqual(passfile.stat().st_mode & 0o777, 0o600)
            self.assertIn(':forum:forum_app:', passfile.read_text())
            self.assertFalse((self.path / 'old-data/storage' / storage / 'forum_app.pgpass').exists())
            registrations = json.loads((self.path / 'new-data' / (user + '.json')).read_text())['Servers']
            self.assertEqual(registrations['1']['Name'], 'Unrelated server')
            target = next(s for s in registrations.values() if s['Name'] == 'AST Forum / Forum PostgreSQL')
            self.assertEqual(target['Username'], 'forum_app')
            self.assertEqual(target['ConnectionParameters']['passfile'], 'forum_app.pgpass')

    def test_missing_recreated_container_fails_before_inspect_or_sync(self):
        result = self.configure(MISSING_RECREATED_ID='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('pgAdmin container is not running after recreate', result.stderr)
        records = [json.loads(line) for line in (self.path / 'commands.jsonl').read_text().splitlines()]
        self.assertFalse(any(r['args'][0] == 'inspect' and r['args'][1].startswith('pgadmin') for r in records))
        self.assertFalse(any('load-servers' in r['args'] for r in records))

    def test_missing_schema_marker_fails_without_broadening_access(self):
        self.sql('DELETE FROM public.schema_migrations; REVOKE ALL ON ALL TABLES IN SCHEMA public FROM forum_app_role;')
        result = self.configure()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('public-schema migration', result.stderr)
        self.assertEqual(self.sql("SELECT has_table_privilege('forum_app','public.persons','DELETE');").stdout.strip(), 'f')
        self.assertFalse((self.path / 'recreated').exists())

    def test_missing_ledger_has_explicit_precondition_error(self):
        self.sql('DROP TABLE public.schema_migrations;')
        result = self.configure()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('public-schema migration', result.stderr)

    def test_invalid_identifiers_are_rejected_before_any_container_command(self):
        for name in ['DB_NAME', 'APP_ROLE', 'APP_USER']:
            result = self.configure(**{name: "bad';SELECT 1;--"})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('invalid PostgreSQL identifier', result.stderr)
        self.assertFalse((self.path / 'commands.jsonl').exists())

    def test_standalone_grant_contract_checks_marker_and_reconciles_acl(self):
        self.sql(GRANTS.read_text())
        self.assert_grants()
        self.sql("DELETE FROM public.schema_migrations; GRANT DELETE ON public.persons TO forum_app_role;")
        result = self.sql(GRANTS.read_text(), check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('public-schema migration', result.stderr)
        # The precondition aborts the transaction without a partial ACL rewrite.
        self.assertEqual(self.sql("SELECT has_table_privilege('forum_app','public.persons','DELETE');").stdout.strip(), 't')


if __name__ == '__main__':
    unittest.main()
