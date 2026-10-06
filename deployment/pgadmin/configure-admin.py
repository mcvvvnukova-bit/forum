#!/usr/bin/env python3
"""Apply pgAdmin 9.17 administrator registrations on the existing Forum host."""

import datetime
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import time


INSTALL = Path('/opt/pgadmin')
SOURCE = Path(__file__).resolve().parent
EMAIL = 'admin@astforum.ru'
CONTAINER = 'pgadmin-pgadmin-1'
DATABASES = {
    'postgres': 'outline-postgres-1',
    'astforum-openproject-db-1': 'astforum-openproject-db-1',
    'astforum-cal-diy-database-1': 'astforum-cal-diy-database-1',
    'astforum-mail-database-1': 'astforum-mail-database-1',
}


def run(*args):
    return subprocess.check_output(args, text=True)


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def escape_pgpass(value):
    if '\n' in value or '\r' in value:
        raise ValueError('A PostgreSQL credential contains a line break')
    return value.replace('\\', '\\\\').replace(':', '\\:')


def private_write(path, content):
    # O_TRUNC preserves the inode of files mounted into an existing container.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)
    os.chmod(path, 0o600)
    os.chown(path, 5050, 5050)


def verify(definitions):
    for attempt in range(30):
        ping = subprocess.run(['curl', '-fsS', '--max-time', '2',
                               'http://127.0.0.1:5050/misc/ping'],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        if ping.returncode == 0 and ping.stdout.strip() == 'PING':
            break
        time.sleep(1)
    else:
        raise RuntimeError('pgAdmin did not become ready')
    probe = '''import psycopg,json
hosts=HOSTS
for host,user,maintenance in hosts:
 with psycopg.connect(host=host,user=user,dbname=maintenance,connect_timeout=10,
   passfile='/var/lib/pgadmin/storage/admin_astforum.ru/.pgpass') as c:
  databases=c.execute("SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname").fetchall()
 for (database,) in databases:
  with psycopg.connect(host=host,user=user,dbname=database,connect_timeout=10,
    passfile='/var/lib/pgadmin/storage/admin_astforum.ru/.pgpass') as c:
   print(json.dumps(dict(zip(['database','role'],c.execute('SELECT current_database(), current_user').fetchone()))))
'''.replace('HOSTS', repr([(v['Host'], v['Username'], v['MaintenanceDB'])
                          for v in definitions.values() if v['Username'] != 'forum_app']))
    print(run('docker', 'exec', CONTAINER, '/venv/bin/python3', '-c', probe))


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run as root on the existing Forum host')
    if SOURCE == INSTALL:
        raise SystemExit('Stage the candidate outside /opt/pgadmin before applying')
    definitions = json.loads((SOURCE / 'servers.json').read_text())['Servers']
    info = inspect(CONTAINER)
    data = Path(next(m['Source'] for m in info['Mounts']
                     if m['Destination'] == '/var/lib/pgadmin'))
    dbpath = data / 'pgadmin4.db'
    storage = data / 'storage' / 'admin_astforum.ru'
    assert storage.is_dir() and dbpath.is_file()

    # Read existing runtime credentials without sending them to command arguments.
    passlines = []
    for host, container in DATABASES.items():
        dbinfo = inspect(container)
        env = dict(item.split('=', 1) for item in dbinfo['Config']['Env'] if '=' in item)
        user = env['POSTGRES_USER']
        if env.get('POSTGRES_PASSWORD_FILE'):
            destination = env['POSTGRES_PASSWORD_FILE']
            secret = Path(next(m['Source'] for m in dbinfo['Mounts']
                               if m['Destination'] == destination))
            password = secret.read_text().rstrip('\r\n')
        else:
            password = env['POSTGRES_PASSWORD']
        assert password
        expected = next(v['Username'] for v in definitions.values()
                        if v['Host'] == host and v['Username'] != 'forum_app')
        assert user == expected, 'Unexpected database role; review configuration'
        passlines.append(':'.join([host, '5432', '*', escape_pgpass(user),
                                   escape_pgpass(password)]))

    # Validate the candidate, using the existing secret paths and external networks.
    for network in ['outline_backend', 'outline_frontend',
                    'astforum-openproject_backend', 'astforum-cal-diy_backend',
                    'astforum-mail_backend']:
        run('docker', 'network', 'inspect', network)
    run('docker', 'compose', '--project-directory', str(INSTALL),
        '-f', str(SOURCE / 'compose.yaml'), 'config', '--quiet')
    with sqlite3.connect(dbpath) as conn:
        admin = conn.execute('SELECT id FROM user WHERE email=? AND active=1',
                             (EMAIL,)).fetchone()
        assert admin, 'Active administrator account is missing'
        admin_id = admin[0]
        assert conn.execute('SELECT 1 FROM roles_users ru JOIN role r ON r.id=ru.role_id '
                            'WHERE ru.user_id=? AND r.name=?',
                            (admin_id, 'Administrator')).fetchone()
        baseline = conn.execute('SELECT id FROM server WHERE user_id=? ORDER BY id',
                                (admin_id,)).fetchall()

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = Path('/opt/backups/pgadmin-admin-connections') / stamp
    backup.mkdir(parents=True, mode=0o700)
    for name in ['compose.yaml', 'servers.json']:
        shutil.copy2(INSTALL / name, backup / name)
        os.chmod(backup / name, 0o600)
    for name in ['.pgpass', 'forum_app.pgpass']:
        if (storage / name).exists():
            shutil.copy2(storage / name, backup / name)
            os.chmod(backup / name, 0o600)
    with sqlite3.connect(dbpath) as src, sqlite3.connect(backup / 'pgadmin4.db') as dst:
        src.backup(dst)
    os.chmod(backup / 'pgadmin4.db', 0o600)
    print('Rollback snapshot:', backup)

    run('docker', 'compose', '-f', str(INSTALL / 'compose.yaml'), 'stop', 'pgadmin')
    try:
        private_write(storage / '.pgpass', '\n'.join(passlines) + '\n')
        with sqlite3.connect(dbpath) as conn:
            conn.row_factory = sqlite3.Row
            group = conn.execute('SELECT id FROM servergroup WHERE user_id=? AND name=?',
                                 (admin_id, 'AST Forum')).fetchone()
            assert group
            template = dict(conn.execute('SELECT * FROM server WHERE user_id=? ORDER BY id',
                                         (admin_id,)).fetchone())
            for definition in definitions.values():
                aliases = [definition['Name']]
                if definition['Name'] == 'AST Forum / PostgreSQL (admin)':
                    aliases.append('AST Forum / Outline PostgreSQL')
                matches = conn.execute('SELECT id FROM server WHERE user_id=? AND name IN (' +
                                       ','.join('?' for _ in aliases) + ')',
                                       [admin_id, *aliases]).fetchall()
                assert len(matches) <= 1, 'Duplicate server registrations; review before applying'
                values = {
                    'user_id': admin_id, 'servergroup_id': group['id'],
                    'name': definition['Name'], 'host': definition['Host'],
                    'port': definition['Port'], 'maintenance_db': definition['MaintenanceDB'],
                    'username': definition['Username'], 'password': None, 'save_password': None,
                    'db_res': definition.get('DBRestriction'),
                    'db_res_type': definition.get('DBRestrictionType'),
                    'connection_params': json.dumps(definition['ConnectionParameters']),
                }
                if matches:
                    conn.execute('UPDATE server SET ' + ','.join(k+'=?' for k in values) +
                                 ' WHERE id=? AND user_id=?',
                                 [*values.values(), matches[0]['id'], admin_id])
                else:
                    row = {k: v for k, v in template.items() if k != 'id'}
                    row.update(values)
                    conn.execute('INSERT INTO server (' + ','.join(row) + ') VALUES (' +
                                 ','.join('?' for _ in row) + ')', list(row.values()))
            after = conn.execute('SELECT id FROM server WHERE user_id=? ORDER BY id',
                                 (admin_id,)).fetchall()
            assert {r[0] for r in baseline} <= {r[0] for r in after}
        for name in ['compose.yaml', 'servers.json']:
            shutil.copyfile(SOURCE / name, INSTALL / name)
        run('docker', 'compose', '-f', str(INSTALL / 'compose.yaml'), 'up', '-d', 'pgadmin')
        verify(definitions)
    except Exception:
        # Only pgAdmin settings are restored; PostgreSQL data and roles are untouched.
        run('docker', 'compose', '-f', str(INSTALL / 'compose.yaml'), 'stop', 'pgadmin')
        shutil.copyfile(backup / 'pgadmin4.db', dbpath)
        os.chown(dbpath, 5050, 5050)
        for name in ['compose.yaml', 'servers.json']:
            shutil.copyfile(backup / name, INSTALL / name)
        if (backup / '.pgpass').exists():
            private_write(storage / '.pgpass', (backup / '.pgpass').read_text())
        run('docker', 'compose', '-f', str(INSTALL / 'compose.yaml'), 'up', '-d', 'pgadmin')
        raise

    print('pgAdmin ready; administrator server IDs preserved.')


if __name__ == '__main__':
    main()
