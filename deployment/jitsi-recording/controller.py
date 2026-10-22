"""Discover live meetings via private Jicofo and briefly request Jibri via BOSH."""
import argparse
import base64
import hashlib
import hmac
import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from xml.sax.saxutils import quoteattr

from vks_common import read, save

BASE = Path('/opt/jitsi-recording')
STATE = BASE / 'state/controller.json'


def humans(conference):
    return [member for member in conference.get('chat_room', {}).get('members', {}).values()
        if not any(member.get(key) for key in ('is_jibri', 'is_jigasi', 'is_transcriber'))
        and '/vks_recorder_' not in member.get('jid', '')]


def should_start(conference, state, available, free_disk, mem_available):
    members = conference.get('chat_room', {}).get('members', {}).values()
    return bool(conference.get('meeting_id') and humans(conference)
        and not any(member.get('is_jibri') for member in members)
        and state.get('status') not in ('started', 'requested', 'observed')
        and available is True and free_disk >= 5 * 1024**3 and mem_available >= 512 * 1024**2)


def debug(path=''):
    result = subprocess.run(['docker', 'exec', 'jitsi-meet-jicofo-1', 'wget', '-qO-',
        'http://127.0.0.1:8888/debug' + path], capture_output=True, text=True, timeout=15, check=True)
    return json.loads(result.stdout)


def jwt(secret, room):
    now = int(time.time())
    data = {'aud':'jitsi_admin', 'iss':secret['jwt_app_id'], 'sub':'vks.mvpspace.ru',
        'room':room, 'iat':now, 'nbf':now-5, 'exp':now+120,
        'context':{'user':{'id':'vks-recording-controller', 'name':'Автозапись встречи', 'moderator':True}}}
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=')
    body = b'.'.join([encode(b'{"alg":"HS256","typ":"JWT"}'), encode(json.dumps(data).encode())])
    return (body + b'.' + encode(hmac.new(secret['jwt_secret'].encode(), body, hashlib.sha256).digest())).decode()


class Bosh:
    def __init__(self, token):
        self.token, self.sid = token, None
        self.rid = int(time.time() * 1000)
        self.resource = 'vks_recorder_' + uuid.uuid4().hex[:12]

    def post(self, content='', extra=''):
        attrs = f'xmlns="http://jabber.org/protocol/httpbind" rid="{self.rid}" '
        if self.sid:
            attrs += 'sid=' + quoteattr(self.sid) + ' '
        self.rid += 1
        request = urllib.request.Request('http://127.0.0.1:8080/http-bind',
            data=f'<body {attrs}{extra}>{content}</body>'.encode(),
            headers={'Content-Type':'text/xml', 'Host':'vks.mvpspace.ru',
                'Origin':'https://vks.mvpspace.ru', 'Authorization':'Bearer ' + self.token})
        with urllib.request.urlopen(request, timeout=10) as response:
            root = ET.fromstring(response.read(2 * 1024**2))
        if self.sid is None:
            self.sid = root.get('sid')
        if root.get('type') == 'terminate' and not extra.startswith('type="terminate"'):
            raise RuntimeError('BOSH session terminated')
        return root

    def connect(self):
        self.post(extra='xmlns:xmpp="urn:xmpp:xbosh" to="meet.jitsi" hold="1" wait="1" ver="1.6" xmpp:version="1.0"')
        root = self.post('<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="ANONYMOUS"/>')
        if not any(element.tag.endswith('success') for element in root.iter()):
            raise RuntimeError('Recording controller authentication failed')
        self.post(extra='xmlns:xmpp="urn:xmpp:xbosh" xmpp:restart="true" to="meet.jitsi"')
        root = self.post('<iq xmlns="jabber:client" type="set" id="bind">'
            '<bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>' + self.resource + '</resource></bind></iq>')
        if not any(element.tag.endswith('jid') for element in root.iter()):
            raise RuntimeError('Recording controller resource binding failed')

    def start(self, room):
        occupant = room + '@muc.meet.jitsi/' + self.resource
        root = self.post('<presence xmlns="jabber:client" to=' + quoteattr(occupant) + '>'
            '<x xmlns="http://jabber.org/protocol/muc"/>'
            '<nick xmlns="http://jabber.org/protocol/nick">Автозапись встречи</nick></presence>')
        for _ in range(8):
            if any(p.get('from') == occupant and p.find('.//{http://jabber.org/protocol/muc#user}item') is not None
                and p.find('.//{http://jabber.org/protocol/muc#user}item').get('role') == 'moderator'
                for p in root.iter('{jabber:client}presence')):
                break
            root = self.post()
        else:
            raise RuntimeError('Recording controller did not obtain moderator role')
        identifier = 'record-' + uuid.uuid4().hex
        root = self.post('<iq xmlns="jabber:client" type="set" id=' + quoteattr(identifier)
            + ' to=' + quoteattr(room + '@muc.meet.jitsi/focus') + '>'
            '<jibri xmlns="http://jitsi.org/protocol/jibri" action="start" recording_mode="file"/></iq>')
        for _ in range(12):
            reply = next((e for e in root.iter('{jabber:client}iq') if e.get('id') == identifier), None)
            if reply is not None:
                if reply.get('type') != 'result':
                    raise RuntimeError('Jicofo rejected recording request')
                item = reply.find('{http://jitsi.org/protocol/jibri}jibri')
                return item.get('session_id') if item is not None else None
            root = self.post()
        raise RuntimeError('Jicofo recording request timed out')

    def close(self):
        if self.sid:
            try:self.post(extra='type="terminate"')
            except Exception:pass
            self.sid = None


def tick():
    state = read(STATE, {})
    live = debug()
    detector = live.get('jibri_detector') or {}
    available = any(isinstance(value, dict) and value.get('reports_available') is True for value in detector.values())
    memory = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines()
        if line.startswith('MemAvailable:'))) * 1024
    free = shutil.disk_usage('/var/lib/jitsi-meet/storage/jibri/recordings').free
    for jid in live.get('focus_manager', {}):
        if not jid.endswith('@muc.meet.jitsi'):
            continue
        conference = debug('/conference/' + urllib.parse.quote(jid, safe='@'))
        meeting = conference.get('meeting_id')
        if not meeting or not humans(conference):
            continue
        entry = state.setdefault(meeting, {'room':jid.split('@')[0], 'firstSeen':time.time()})
        has_recorder = any(member.get('is_jibri') for member in conference.get('chat_room', {}).get('members', {}).values())
        if has_recorder:
            entry.update(status='observed' if entry.get('status') != 'started' else 'started',
                lastSeen=time.time(), lastRecorderSeen=time.time())
            continue
        if entry.get('status') in ('started', 'observed', 'requested'):
            reference = max(entry.get('startedAt', 0), entry.get('lastRecorderSeen', 0),
                entry.get('firstSeen', 0))
            if time.time() - reference < 45:
                continue  # Accepted startup and brief membership gaps need a grace period.
            entry.update(status='retry', reason='recorder-disappeared', interruptedAt=time.time(),
                interruptions=entry.get('interruptions', 0)+1, retryAt=time.time()+10)
            print(json.dumps({'event':'recording-interrupted', 'meetingId':meeting}), flush=True)
        if not should_start(conference, entry, available, free, memory):
            if entry.get('status') not in ('started', 'observed', 'requested'):
                entry.update(status='waiting', reason='recorder-busy-or-resource-limit', lastSeen=time.time())
            continue
        if time.time() < entry.get('retryAt', 0):
            continue
        client = Bosh(jwt(read('/opt/jitsi-admin/secrets/access.private.json'), entry['room']))
        try:
            # Recheck identity and occupancy immediately before creating a control participant.
            current = debug('/conference/' + urllib.parse.quote(jid, safe='@'))
            if current.get('meeting_id') != meeting or not humans(current):
                continue
            client.connect()
            entry['recordingSessionId'] = client.start(entry['room'])
            entry.update(status='started', startedAt=time.time())
            available = False
            print(json.dumps({'event':'recording-requested', 'meetingId':meeting}), flush=True)
        except Exception as error:
            attempts = entry.get('attempts', 0) + 1
            entry.update(status='retry', attempts=attempts, errorType=type(error).__name__,
                retryAt=time.time() + min(120, 10 * attempts))
            print(json.dumps({'event':'recording-retry', 'meetingId':meeting, 'errorType':type(error).__name__}), flush=True)
        finally:
            client.close()
            save(STATE, state)
    save(STATE, state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    options = parser.parse_args()
    while True:
        try:tick()
        except Exception as error:print(json.dumps({'event':'controller-error','errorType':type(error).__name__}), flush=True)
        if options.once:return
        time.sleep(5)


if __name__ == '__main__':main()
