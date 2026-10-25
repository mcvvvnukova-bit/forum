import importlib.util
from pathlib import Path
import unittest
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'deployment/jitsi-recording'))


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'deployment/jitsi-recording' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ControllerTests(unittest.TestCase):
    def test_recovers_after_failed_startup_or_recorder_loss_without_duplicate_requests(self):
        from unittest.mock import ANY, patch, Mock
        from types import SimpleNamespace
        import copy
        controller=load('controller')
        meeting='fixture-meeting';jid='fixture@muc.meet.jitsi'
        conference={'meeting_id':meeting,'chat_room':{'members':{'human':{'jid':'person@meet.jitsi/client'}}}}
        live={'focus_manager':{jid:1},'jibri_detector':{'recorder':{'reports_available':True}}}
        for previous in ({'status':'started','startedAt':50}, {'status':'observed','lastRecorderSeen':50}):
            with self.subTest(previous=previous):
                state={meeting:{'room':'fixture','firstSeen':40,**previous}}
                bot=Mock();bot.start.return_value='recording-session'
                def persist(path,value):state.clear();state.update(copy.deepcopy(value))
                with patch.object(controller,'read',side_effect=lambda path,*_:copy.deepcopy(state)), \
                     patch.object(controller,'sync_controls'), \
                     patch.object(controller,'save',side_effect=persist), \
                     patch.object(controller,'debug',side_effect=lambda path='':conference if path else live), \
                     patch.object(controller,'Path',return_value=SimpleNamespace(read_text=lambda:'MemAvailable: 2097152 kB')), \
                     patch.object(controller.shutil,'disk_usage',return_value=SimpleNamespace(free=10*1024**3)), \
                     patch.object(controller,'jwt',return_value='fixture'), \
                     patch.object(controller,'Bosh',return_value=bot), \
                     patch.object(controller.time,'time',return_value=200) as now:
                    controller.tick()
                    self.assertEqual(state[meeting]['status'],'retry')
                    self.assertEqual(state[meeting]['interruptions'],1)
                    bot.start.assert_not_called()
                    now.return_value=220;controller.tick()
                    bot.start.assert_called_once_with('fixture', before_start=ANY)
                    self.assertEqual(state[meeting]['status'],'started')
                    now.return_value=225;controller.tick()
                    bot.start.assert_called_once()

    def test_only_humans_trigger_recording_and_meeting_ids_are_required(self):
        controller = load('controller')
        room = {'meeting_id': 'meeting-1', 'chat_room': {'members': {
            'bot': {'jid': 'recorder@hidden.meet.jitsi/a', 'is_jibri': True},
            'ctl': {'jid': 'x@meet.jitsi/vks_recorder_123'},
        }}}
        self.assertFalse(controller.should_start(room, {}, True, 10*1024**3, 1024**3))
        room['chat_room']['members']['person'] = {'jid': 'person@meet.jitsi/x'}
        self.assertFalse(controller.should_start(room, {}, True, 10*1024**3, 1024**3))
        del room['chat_room']['members']['bot']
        self.assertTrue(controller.should_start(room, {}, True, 10*1024**3, 1024**3))
        self.assertFalse(controller.should_start(room, {'status':'started'}, True, 10*1024**3, 1024**3))
        self.assertFalse(controller.should_start(room, {}, False, 10*1024**3, 1024**3))
        self.assertFalse(controller.should_start(room, {}, True, 1024**3, 1024**3))
        self.assertFalse(controller.should_start(room, {}, True, 10*1024**3, 100*1024**2))
        del room['meeting_id']
        self.assertFalse(controller.should_start(room, {}, True, 10*1024**3, 1024**3))


class SummaryTests(unittest.TestCase):
    def test_publishes_transcript_when_summary_access_is_denied_then_updates_same_page(self):
        pipeline = load('pipeline')
        import tempfile
        from unittest.mock import patch
        class Fake(pipeline.Pipeline):
            def __init__(self):
                self.outline={'url':'https://outline.mvpspace.ru','collectionId':'collection'}
                self.config={}
                self.docs={};self.creates=0;self.allowed=False
            def probe(self, movie):return 8
            def identity(self):pass
            def transcribe(self, movie, work, duration):return [{'id':'s1','start':0,'end':8,'text':'Тестовая встреча.'}]
            def summarize(self, segments):
                if not self.allowed:raise pipeline.ApiError(403)
                return {'key_points':[],'decisions':[],'tasks':[]}
            def api(self, method, payload):
                if method=='documents.info':
                    if payload['id'] not in self.docs:raise pipeline.ApiError(404)
                    return self.docs[payload['id']]
                if method=='documents.create':
                    import uuid
                    if uuid.UUID(payload['id']).version != 4:raise AssertionError('Outline model requires UUIDv4')
                    self.creates+=1;self.docs[payload['id']]={**payload,'url':'/doc/test'}
                    return self.docs[payload['id']]
                if method=='documents.update':self.docs[payload['id']].update(payload);return self.docs[payload['id']]
                raise AssertionError(method)
            def attachment(self, document_id, path, content_type, state, name, state_path):return '/api/attachments.redirect?id='+name
        with tempfile.TemporaryDirectory() as directory, patch.object(pipeline,'BASE',Path(directory)):
            folder=Path(directory)/'recording';folder.mkdir();(folder/'a.mp4').write_bytes(b'fixture')
            fake=Fake();first=fake.process(folder)
            self.assertEqual(first['status'],'awaiting-summary')
            self.assertIn('Саммари пока недоступно',fake.docs[first['documentId']]['text'])
            fake.allowed=True;second=fake.process(folder)
            self.assertEqual(second['status'],'complete')
            self.assertEqual(first['documentId'],second['documentId'])
            self.assertEqual(fake.creates,1)
            # Codex supplies a validated cache; this mode must never call Polza's text API.
            from unittest.mock import Mock
            codex_folder=Path(directory)/'codex-recording';codex_folder.mkdir()
            (codex_folder/'a.mp4').write_bytes(b'fixture')
            codex=Fake();codex.config={'summaryMode':'codex'}
            codex.summarize=Mock(side_effect=AssertionError('External text model called'))
            pending=codex.process(codex_folder)
            codex.summarize.assert_not_called()
            self.assertEqual(pending['status'],'awaiting-summary')
            self.assertIn('ежедневной обработки Codex',codex.docs[pending['documentId']]['text'])
            pipeline.save(Path(directory)/'work/codex-recording/summary.json',
                {'key_points':[],'decisions':[],'tasks':[]})
            done=codex.process(codex_folder)
            self.assertEqual(done['status'],'complete')
            self.assertEqual(pending['documentId'],done['documentId'])
            self.assertIn('Codex',codex.docs[done['documentId']]['text'])
            self.assertNotIn('через Polza. Автоматическое',codex.docs[done['documentId']]['text'])

    def test_cached_daily_summaries_resume_pending_jobs_and_respect_completed_jobs(self):
        pipeline=load('pipeline')
        self.assertFalse(pipeline.job_due({},10,100,200))
        self.assertTrue(pipeline.job_due({'status':'awaiting-summary','retryAt':300},10,100,200,True))
        self.assertFalse(pipeline.job_due({'status':'awaiting-summary','retryAt':300},10,100,200,False))
        self.assertTrue(pipeline.job_due({'status':'awaiting-summary','retryAt':100},10,100,200))
        self.assertFalse(pipeline.job_due({'status':'complete'},150,100,200,True,True))

    def test_rejects_invented_evidence_and_task_owners(self):
        pipeline = load('pipeline')
        segments = [{'id':'s1', 'start':0, 'end':120, 'text':'Анна подготовит отчёт к понедельнику.'}]
        summary = {'key_points':[], 'decisions':[], 'tasks':[
            {'text':'Подготовить отчёт', 'owner':'Анна', 'deadline':'понедельнику',
             'segment_id':'s1', 'evidence':'Анна подготовит отчёт к понедельнику.'}]}
        self.assertEqual(pipeline.validate_summary(summary, segments), summary)
        summary['tasks'][0]['owner'] = 'Иван'
        with self.assertRaises(ValueError):pipeline.validate_summary(summary, segments)
        summary['tasks'][0]['owner'] = 'Анна'
        summary['tasks'][0]['evidence'] = 'Потратить миллион рублей'
        with self.assertRaises(ValueError):pipeline.validate_summary(summary, segments)

    def test_ignores_unfinalized_and_escaping_recordings(self):
        pipeline = load('pipeline')
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            pending=root/'pending';pending.mkdir();(pending/'a.mp4').write_bytes(b'video')
            ready=root/'ready';ready.mkdir();(ready/'a.mp4').write_bytes(b'video')
            (ready/'.recording-complete').touch()
            (root/'outside').symlink_to('/tmp', target_is_directory=True)
            self.assertEqual(pipeline.completed_recordings(root), [ready])


if __name__ == '__main__':unittest.main()
