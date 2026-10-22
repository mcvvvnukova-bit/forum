"""Run on the VPS. Isolated XMPP fixtures; never print credentials or tokens."""
import base64
import hashlib
import hmac
import json
from pathlib import Path
import time
import urllib.request
import uuid
import xml.etree.ElementTree as ET

BASE = 'https://vks.mvpspace.ru'
PRIVATE = Path('/opt/jitsi-admin/secrets/access.private.json')


class AuthenticationRejected(Exception):
    pass


class Bosh:
    def __init__(self, domain, token=None):
        self.rid = int(time.time() * 1000)
        self.sid = None
        self.token = token
        self.domain = domain
        self.resource = 'proj213_' + uuid.uuid4().hex[:10]
        self.post(extra=f'xmlns:xmpp="urn:xmpp:xbosh" to="{domain}" hold="1" wait="1" ver="1.6" xmpp:version="1.0"')
        auth = self.post('<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="ANONYMOUS"/>')
        if not any(e.tag.endswith('success') for e in auth.iter()):
            self.close()
            raise AuthenticationRejected('XMPP authentication rejected')
        self.post(extra=f'xmlns:xmpp="urn:xmpp:xbosh" xmpp:restart="true" to="{domain}"')
        bound = self.post('<iq xmlns="jabber:client" type="set" id="bind1">'
            '<bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">'
            f'<resource>{self.resource}</resource></bind></iq>')
        assert any(e.tag.endswith('jid') for e in bound.iter()), 'Resource binding failed'

    def post(self, inner='', extra=''):
        attrs = f'xmlns="http://jabber.org/protocol/httpbind" rid="{self.rid}" '
        if self.sid:
            attrs += f'sid="{self.sid}" '
        self.rid += 1
        headers = {'Content-Type': 'text/xml; charset=utf-8', 'Origin': BASE}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        req = urllib.request.Request(BASE + '/http-bind', data=f'<body {attrs}{extra}>{inner}</body>'.encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=20) as response:
            root = ET.fromstring(response.read())
        if self.sid is None:
            self.sid = root.attrib.get('sid')
        return root

    def join(self, room):
        response = self.post(f'<presence xmlns="jabber:client" to="{room}@muc.meet.jitsi/{self.resource}">'
            '<x xmlns="http://jabber.org/protocol/muc"/><nick xmlns="http://jabber.org/protocol/nick">PROJ-213 QA</nick></presence>')
        for _ in range(3):
            for presence in response.iter('{jabber:client}presence'):
                if presence.attrib.get('type') == 'error':
                    return {'error': True, 'role': None, 'affiliation': None,
                        'conditions': [e.tag for e in presence.iter() if 'xmpp-stanzas' in e.tag]}
                if presence.attrib.get('from', '').endswith('/' + self.resource):
                    item = next(presence.iter('{http://jabber.org/protocol/muc#user}item'), None)
                    if presence.attrib.get('type') == 'error':
                        return {'error': True, 'role': None, 'affiliation': None}
                    if item is not None:
                        return {'error': False, 'role': item.attrib.get('role'), 'affiliation': item.attrib.get('affiliation')}
            response = self.post()
        return {'waiting': True, 'role': None, 'affiliation': None}

    def conference(self, room):
        iq_id = 'conference-' + uuid.uuid4().hex
        response = self.post(f'<iq xmlns="jabber:client" type="set" to="focus.meet.jitsi" id="{iq_id}">'
            f'<conference xmlns="http://jitsi.org/protocol/focus" room="{room}@muc.meet.jitsi" machine-uid="{self.resource}"/></iq>')
        for _ in range(5):
            iq = next((e for e in response.iter() if e.attrib.get('id') == iq_id), None)
            if iq is not None:
                return iq.attrib.get('type')
            response = self.post()
        raise AssertionError('No conference response from Jicofo')

    def close(self):
        if self.sid:
            try:
                self.post(extra='type="terminate"')
            except Exception:
                pass
            self.sid = None


def main():
    secrets = json.loads(PRIVATE.read_text())
    room = str(uuid.uuid4())
    sessions = []
    now = int(time.time())

    def token(moderator=True, signing_key=None, **overrides):
        data = {'aud': 'jitsi_admin', 'iss': secrets['jwt_app_id'], 'sub': 'vks.mvpspace.ru',
            'room': room, 'iat': now, 'nbf': now - 5, 'exp': now + 180,
            'context': {'user': {'id': 'proj213-qa', 'name': 'PROJ-213 QA', 'moderator': moderator}}}
        data.update(overrides)
        enc = lambda x: base64.urlsafe_b64encode(x).rstrip(b'=')
        parts = [enc(b'{"alg":"HS256","typ":"JWT"}'), enc(json.dumps(data).encode())]
        parts.append(enc(hmac.new((signing_key or secrets['jwt_secret']).encode(), b'.'.join(parts), hashlib.sha256).digest()))
        return b'.'.join(parts).decode()

    def connect(domain, jwt=None):
        session = Bosh(domain, jwt)
        sessions.append(session)
        return session

    checks = {}
    try:
        invalid_tokens = [('empty', None), ('forged', token()[:-8] + 'AAAAAAAA'), ('expired', token(exp=now - 60)), ('wrong-issuer', token(iss='other')), ('wrong-audience', token(aud='other'))]
        retired = PRIVATE.with_name('retired-key.private.json')
        if retired.exists():
            invalid_tokens.append(('retired-key', token(signing_key=json.loads(retired.read_text())['jwt_secret'])))
        for name, jwt in invalid_tokens:
            try:
                connect('meet.jitsi', jwt)
            except AuthenticationRejected:
                checks[name + 'Rejected'] = True
            else:
                raise AssertionError(name + ' primary-realm authentication was accepted')
        early_guest = connect('guest.meet.jitsi')
        assert early_guest.conference(room) == 'error', 'Anonymous guest started a conference'
        before = early_guest.join(room)
        assert before['role'] not in ('participant', 'moderator'), 'Guest entered before host'
        checks['guestWaitsBeforeHost'] = True
        invited = connect('meet.jitsi', token(False))
        assert invited.conference(room) == 'result', 'Invited token could not request the focus'
        early_participant = invited.join(room)
        assert early_participant['role'] not in ('participant', 'moderator'), 'Participant token bypassed the host gate'
        checks['participantWaitsBeforeHost'] = True
        organizer = connect('meet.jitsi', token())
        assert organizer.conference(room) == 'result', 'Authorized host could not start the conference'
        host = organizer.join(room)
        assert host['role'] == 'moderator' and host['affiliation'] == 'owner', 'Host did not receive moderator ownership: ' + json.dumps(host)
        checks['hostIsModerator'] = True
        participant = connect('meet.jitsi', token(False)).join(room)
        assert participant['role'] == 'participant' and participant['affiliation'] != 'owner', 'Participant became a moderator'
        checks['participantIsNotModerator'] = True
        plain_guest = connect('guest.meet.jitsi')
        assert plain_guest.conference(room) == 'result', 'Plain Cal guest was rejected by the focus'
        guest = plain_guest.join(room)
        assert guest['role'] == 'participant' and guest['affiliation'] != 'owner', 'Plain guest could not join the started room'
        checks['plainCalGuestJoinsAfterHost'] = True
        other = connect('meet.jitsi', token(room=room + '-other'))
        assert other.conference(room + '-other') == 'result'
        assert other.join(room + '-other')['role'] == 'moderator'
        wrong_room = connect('meet.jitsi', token()).join(room + '-other')
        assert wrong_room.get('error') is True, 'Room-scoped token entered another room'
        checks['wrongRoomRejected'] = True
        print(json.dumps({'checkedAtUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'checks': checks, 'realMediaTested': False}, indent=2))
    finally:
        for session in reversed(sessions):
            session.close()


if __name__ == '__main__':
    main()
