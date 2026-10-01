"""Integration checks against this VPS only. Sends one synthetic local test message.

Until public TLS is provisioned, this explicitly pins the bootstrap certificate
obtained through authenticated SSH and verifies its localhost identity. This is
not a public certificate or Internet deliverability test.
"""
import base64
import email.message
import email.parser
import email.utils
import imaplib
import json
import pathlib
import smtplib
import ssl
import time
import urllib.request

ROOT = pathlib.Path('/opt/astforum-mail')
SECRETS = ROOT / 'secrets'


def secret(name):
    return (SECRETS / name).read_text().strip()


def jmap(username, password, payload=None):
    headers = {'Authorization': 'Basic ' + base64.b64encode(f'{username}:{password}'.encode()).decode()}
    path = '/.well-known/jmap' if payload is None else '/jmap/'
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request('http://127.0.0.1:18080' + path,
        data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
    return json.load(urllib.request.urlopen(request, timeout=20))


def main():
    tls = ssl.create_default_context(cafile=str(ROOT / 'server-certificate-observed.pem'))
    mailbox_password = secret('test_mailbox_password')
    sender_password = secret('newsletter_password')
    with smtplib.SMTP_SSL('localhost', 465, context=tls, timeout=15) as smtp:
        smtp.login('newsletter@astforum.ru', sender_password)
        code, _ = smtp.mail('bounces@astforum.ru')
        assert code == 250, ('bounce sender rejected', code)
        smtp.rset()
        code, _ = smtp.mail('admin@astforum.ru')
        assert code >= 500, ('unauthorized sender accepted', code)
        smtp.rset()
        message = email.message.EmailMessage()
        message['From'] = 'newsletter@astforum.ru'
        message['To'] = 'mailtest@astforum.ru'
        message['Subject'] = 'AST Forum local mail integration check'
        message['Date'] = email.utils.formatdate(localtime=False)
        message['Message-ID'] = email.utils.make_msgid(domain='astforum.ru')
        message.set_content('Synthetic local installation check. No external recipient.')
        refused = smtp.send_message(message, from_addr='bounces@astforum.ru', to_addrs=['mailtest@astforum.ru'])
        assert not refused, refused
    print('PASS SMTP AUTH, allowed bounce sender, rejected unauthorized envelope, local submission')

    with smtplib.SMTP('localhost', 25, timeout=10) as smtp:
        smtp.ehlo('mail.astforum.ru')
        code, _ = smtp.mail('postmaster@astforum.ru')
        if code == 250:
            code, _ = smtp.rcpt('installation-probe@example.net')
        assert code >= 500, ('unauthenticated relay accepted', code)
    print('PASS unauthenticated external relay rejected before DATA')

    with imaplib.IMAP4_SSL('localhost', 993, ssl_context=tls, timeout=15) as imap:
        assert imap.login('mailtest@astforum.ru', mailbox_password)[0] == 'OK'
        found = False
        for _ in range(10):
            assert imap.select('INBOX')[0] == 'OK'
            status, ids = imap.search(None, 'ALL')
            assert status == 'OK'
            for uid in ids[0].split():
                status, parts = imap.fetch(uid, '(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])')
                assert status == 'OK'
                headers = b''.join(part[1] for part in parts if isinstance(part, tuple))
                parsed = email.parser.BytesParser().parsebytes(headers)
                if parsed.get('Message-ID') == message['Message-ID']:
                    found = True
                    break
            if found:
                break
            time.sleep(1)
        assert found, 'Submitted local test message not found in IMAP INBOX'
    print('PASS IMAPS login and received local message')

    session = jmap('mailtest@astforum.ru', mailbox_password)
    account_id = session['primaryAccounts']['urn:ietf:params:jmap:mail']
    result = jmap('mailtest@astforum.ru', mailbox_password, {
        'using': ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
        'methodCalls': [['Email/get', {'accountId': account_id,
            'properties': ['id', 'messageId']}, 'mail']],
    })
    assert result['methodResponses'][0][0] == 'Email/get', result
    expected_id = str(message['Message-ID']).strip('<>')
    assert any(expected_id in item.get('messageId', [])
               for item in result['methodResponses'][0][1]['list']), 'Local message absent from JMAP'
    print('PASS same received message accessible through JMAP')
    print('LIMIT: TLS above uses pinned bootstrap localhost certificate, not public mail.astforum.ru TLS')


if __name__ == '__main__':
    main()
