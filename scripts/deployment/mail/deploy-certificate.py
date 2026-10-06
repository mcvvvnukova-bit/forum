#!/usr/bin/python3
"""Certbot deploy hook: validate and import the mail certificate, then verify TLS.

Private material stays on the VPS. Existing certificates are never deleted.
Only this hook's certificate object is updated on subsequent renewals.
"""
import hashlib
import json
import os
import pathlib
import socket
import ssl
import subprocess
import time

from stalwart_api import ROOT, SECRETS, call, save_private

HOST = 'mail.astforum.ru'
LINEAGE = pathlib.Path('/etc/letsencrypt/live') / HOST
STATE = SECRETS / 'certbot-certificate.private.json'


def output(*args, data=None):
    return subprocess.check_output(args, input=data, stderr=subprocess.PIPE)


def main():
    os.umask(0o077)
    if os.environ.get('RENEWED_LINEAGE', str(LINEAGE)) != str(LINEAGE):
        return
    subprocess.run(['openssl', 'verify', '-CApath', '/etc/ssl/certs',
                    '-untrusted', str(LINEAGE / 'chain.pem'),
                    '-verify_hostname', HOST, str(LINEAGE / 'cert.pem')],
                   check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['openssl', 'x509', '-in', str(LINEAGE / 'cert.pem'),
                    '-checkend', '604800', '-noout'], check=True,
                   stdout=subprocess.DEVNULL)
    cert_pub = output('openssl', 'x509', '-in', str(LINEAGE / 'cert.pem'), '-pubkey', '-noout')
    key_pub = output('openssl', 'pkey', '-in', str(LINEAGE / 'privkey.pem'), '-pubout')
    assert cert_pub == key_pub, 'Certificate and private key do not match'
    expected = hashlib.sha256(output('openssl', 'x509', '-in',
                              str(LINEAGE / 'cert.pem'), '-outform', 'DER')).digest()
    value = {'certificate': {'@type': 'Text', 'value': (LINEAGE / 'fullchain.pem').read_text()},
             'privateKey': {'@type': 'Text', 'secret': (LINEAGE / 'privkey.pem').read_text()}}
    if STATE.exists():
        certificate_id = json.loads(STATE.read_text())['id']
        previous = call('x:Certificate/get', {'ids': [certificate_id]})['list']
        assert len(previous) == 1, 'Managed certificate object is missing'
        save_private('certbot-certificate-previous.private.json', previous[0])
        call('x:Certificate/set', {'update': {certificate_id: value}})
    else:
        created = call('x:Certificate/set', {'create': {'certbot': value}})
        certificate_id = created['created']['certbot']['id']
        save_private(STATE.name, {'id': certificate_id})
    call('x:SystemSettings/set', {'update': {'singleton': {'defaultCertificateId': certificate_id}}})
    call('x:Action/set', {'create': {'reload': {'@type': 'ReloadTlsCertificates'}}})
    deadline = time.monotonic() + 45
    while True:
        try:
            with socket.create_connection(('127.0.0.1', 465), timeout=5) as raw:
                with ssl.create_default_context().wrap_socket(raw, server_hostname=HOST) as tls:
                    assert hashlib.sha256(tls.getpeercert(binary_form=True)).digest() == expected
            break
        except (OSError, AssertionError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)
    print('PASS: trusted renewed certificate is served by Stalwart for ' + HOST)


if __name__ == '__main__':
    main()
