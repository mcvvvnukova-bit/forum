from contextlib import contextmanager
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import ANY, Mock, patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'deployment/jitsi-recording'))
MEETING = '11111111-2222-4333-8444-555555555555'
JID = 'fixture@muc.meet.jitsi'


def load_controller():
    spec = importlib.util.spec_from_file_location(
        'controller', ROOT / 'deployment/jitsi-recording/controller.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def publication(status='off', actor='moderator', meeting=MEETING, second=0, extra='', mode='file'):
    return (f'2026-10-25T17:00:{second:02d}.000000000Z Jicofo INFO: '
        f'[room={JID} meeting_id={meeting}] '
        'JibriRecorder.publishJibriRecordingStatus#185: '
        'Publishing new jibri-recording-status: '
        "<jibri-recording-status xmlns='http://jitsi.org/protocol/jibri' "
        f"status='{status}' initiator='{JID}/{actor}' recording_mode='{mode}' "
        f"session_id='recording-session' {extra}/> in: {JID}\n")


class ManualRecordingTests(unittest.TestCase):
    @contextmanager
    def scenario(self, logs):
        controller = load_controller()
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / 'controller.json'
            cursor_path = Path(directory) / 'controls.json'
            controller.save(state_path, {MEETING: {'room': 'fixture', 'firstSeen': 40,
                'status': 'started', 'startedAt': 50}})
            bot = Mock()
            bot.start.return_value = 'new-session'
            conference = {'meeting_id': MEETING, 'chat_room': {'members': {
                'human': {'jid': 'person@meet.jitsi/client'}}}}
            live = {'focus_manager': {JID: 1},
                'jibri_detector': {'recorder': {'reports_available': True}}}
            fixture = SimpleNamespace(controller=controller, state_path=state_path,
                cursor_path=cursor_path, bot=bot, conference=conference, logs=logs, commands=[],
                bosh_class=controller.Bosh)

            def docker_logs(argv, **kwargs):
                fixture.commands.append(argv)
                if isinstance(fixture.logs, Exception):
                    raise fixture.logs
                kwargs['stdout'].write(fixture.logs)
                return SimpleNamespace(returncode=0)

            with patch.object(controller, 'STATE', state_path), \
                 patch.object(controller, 'CONTROL_STATE', cursor_path), \
                 patch.object(controller.subprocess, 'run', side_effect=docker_logs), \
                 patch.object(controller, 'debug', side_effect=lambda path='': conference if path else live), \
                 patch.object(controller, 'Path', return_value=SimpleNamespace(read_text=lambda: 'MemAvailable: 2097152 kB')), \
                 patch.object(controller.shutil, 'disk_usage', return_value=SimpleNamespace(free=10*1024**3)), \
                 patch.object(controller, 'jwt', return_value='fixture'), \
                 patch.object(controller, 'Bosh', return_value=bot), \
                 patch.object(controller.time, 'time', return_value=200) as now:
                fixture.now = now
                yield fixture

    def test_successful_manual_start_restores_recovery_after_a_later_failure(self):
        with self.scenario(publication()) as f:
            f.controller.tick()
            f.logs += publication('on', second=10)
            for timestamp in (400, 460, 480):
                f.now.return_value = timestamp
                f.controller.tick()
            entry = f.controller.read(f.state_path)[MEETING]
            self.assertFalse(entry['manualPaused'])
            self.assertEqual(entry['recordingSessionId'], 'new-session')
            self.assertEqual(entry['interruptions'], 1)
            f.bot.start.assert_called_once_with('fixture', before_start=ANY)

    def test_same_room_with_a_new_meeting_id_is_recorded(self):
        with self.scenario(publication()) as f:
            f.controller.tick()
            f.conference['meeting_id'] = 'new-meeting'
            f.controller.tick()
            state = f.controller.read(f.state_path)
            self.assertTrue(state[MEETING]['manualPaused'])
            self.assertEqual(state['new-meeting']['recordingSessionId'], 'new-session')
            f.bot.start.assert_called_once_with('fixture', before_start=ANY)

    def test_stop_arriving_during_final_prestart_check_prevents_connecting(self):
        with self.scenario('') as f:
            def logs(argv, **kwargs):
                kwargs['stdout'].write('' if len(f.commands) == 0 else publication())
                f.commands.append(argv)
            with patch.object(f.controller.subprocess, 'run', side_effect=logs):
                f.controller.tick()  # Old recorder is missing: enter retry backoff.
                f.now.return_value = 220
                f.commands.clear()
                f.controller.tick()  # Stop arrives between initial and final checks.
            self.assertTrue(f.controller.read(f.state_path)[MEETING]['manualPaused'])
            f.bot.connect.assert_not_called()
            f.bot.start.assert_not_called()

    def test_stop_while_joining_as_moderator_prevents_the_recording_start_iq(self):
        with self.scenario('') as f:
            bot = f.bosh_class('fixture')
            requests = []
            def post(content='', extra=''):
                requests.append(content)
                if content.startswith('<presence'):
                    f.logs = publication('on') + publication(second=10)
                    return ET.fromstring(f'<body><presence xmlns="jabber:client" '
                        f'from="{JID}/{bot.resource}"><x xmlns="http://jabber.org/protocol/muc#user">'
                        '<item role="moderator"/></x></presence></body>')
                identifier = ET.fromstring(content).get('id')
                return ET.fromstring(f'<body><iq xmlns="jabber:client" id="{identifier}" type="result">'
                    '<jibri xmlns="http://jitsi.org/protocol/jibri" session_id="unexpected"/></iq></body>')
            f.controller.tick()
            f.now.return_value = 220
            with patch.object(f.controller, 'Bosh', return_value=bot), \
                 patch.object(bot, 'connect'), patch.object(bot, 'post', side_effect=post):
                f.controller.tick()
            self.assertFalse(any('action="start"' in request for request in requests))
            self.assertTrue(f.controller.read(f.state_path)[MEETING]['manualPaused'])

    def test_log_failure_does_not_start_recording_or_advance_checkpoint(self):
        import subprocess
        with self.scenario(subprocess.CalledProcessError(1, ['docker', 'logs'])) as f:
            with self.assertRaises(subprocess.CalledProcessError):
                f.controller.tick()
            self.assertFalse(f.cursor_path.exists())
            f.bot.start.assert_not_called()

    def test_choice_is_saved_before_checkpoint_and_replay_never_unpauses(self):
        with self.scenario(publication()) as f:
            state = f.controller.read(f.state_path)
            original_save = f.controller.save
            def fail_state_write(path, value):
                if path == f.state_path:
                    raise OSError('state write failed')
                original_save(path, value)
            with patch.object(f.controller, 'save', side_effect=fail_state_write):
                with self.assertRaises(OSError):
                    f.controller.sync_controls(state)
            self.assertFalse(f.cursor_path.exists())
            f.controller.tick()
            # Later automatic ON must not undo a human stop, even on replay.
            f.logs = publication('on', actor='vks_recorder_123', second=20) + publication()
            f.now.return_value = 1000
            f.controller.tick()
            self.assertTrue(f.controller.read(f.state_path)[MEETING]['manualPaused'])
            self.assertEqual(float(f.commands[-1][4]), 198)  # persisted checkpoint minus overlap
            f.bot.start.assert_not_called()

    def test_out_of_order_publications_use_the_latest_human_choice(self):
        with self.scenario(publication('on', second=10) + publication()) as f:
            state = f.controller.read(f.state_path)
            f.controller.sync_controls(state)
            self.assertFalse(f.controller.read(f.state_path)[MEETING]['manualPaused'])
            f.logs = publication()  # Delayed older stop must not undo the later manual start.
            f.controller.sync_controls(state)
            self.assertFalse(f.controller.read(f.state_path)[MEETING]['manualPaused'])

    def test_only_confirmed_human_file_statuses_change_automatic_recording(self):
        controller = load_controller()
        ignored = (publication(actor='vks_recorder_123')
            + publication(extra="failure_reason='error'")
            + publication(mode='stream')
            + publication(actor='')
            + publication().replace(f"{JID}/moderator", 'other@muc.meet.jitsi/moderator')
            + publication().replace('Publishing new jibri-recording-status:', 'Accepted jibri request:'))
        self.assertEqual(list(controller.recording_controls(ignored.splitlines())), [])
        self.assertEqual(list(controller.recording_controls(publication().splitlines())),
            [('2026-10-25T17:00:00.000000000Z', MEETING, 'fixture', 'off')])
        self.assertFalse(controller.should_start({'meeting_id': MEETING,
            'chat_room': {'members': {'person': {'jid': 'person@meet.jitsi/a'}}}},
            {'status': 'waiting', 'manualPaused': True}, True, 10*1024**3, 1024**3))

    def test_malformed_confirmed_status_refuses_automatic_starts(self):
        with self.scenario(publication().replace("status='off'", "status='off' broken")) as f:
            with self.assertRaises(ET.ParseError):
                f.controller.tick()
            f.bot.start.assert_not_called()
            self.assertFalse(f.cursor_path.exists())

    def test_manual_stop_stays_paused_after_recorder_departure_and_controller_restart(self):
        with self.scenario(publication()) as f:
            f.conference['chat_room']['members']['recorder'] = {'is_jibri': True}
            f.controller.tick()
            # The recorder can still appear briefly after the stop publication.
            del f.conference['chat_room']['members']['recorder']
            for timestamp in (300, 400, 1000):
                f.now.return_value = timestamp
                f.controller.tick()  # Reloads persisted state, as after a restart.
            entry = f.controller.read(f.state_path)[MEETING]
            f.bot.start.assert_not_called()
            self.assertEqual(entry['status'], 'paused')
            self.assertNotIn('interruptions', entry)


if __name__ == '__main__':
    unittest.main()
