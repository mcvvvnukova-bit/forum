"""Behavioral regressions for the tracked, exact-file Primer policy."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
ENTRY = REPO / 'scripts/verification/check-primer-ui.py'
VENDOR = REPO / 'scripts/verification/primer-ui/validate_primer_ui.py'


class PrimerPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'web'
        self.root.mkdir()
        (self.root / 'package.json').write_text(json.dumps({'dependencies': {
            '@primer/react': '38.37.0', '@primer/primitives': '11.10.0',
            '@primer/octicons-react': '19.33.0'}}))
        self.write('src/main.tsx', '''import {createRoot} from 'react-dom/client'
import {ThemeProvider, BaseStyles, Button} from '@primer/react'
import '@primer/primitives/dist/css/functional/themes/light.css'
createRoot(document.getElementById('root')).render(
<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><Button>Test</Button></BaseStyles></ThemeProvider>)
''')
        for path in ('src/home/forum-tokens.css', 'src/audience/forum-tokens.css', 'src/auth/sber-tokens.css'):
            source = REPO / 'apps/web' / path
            self.write(path, source.read_text())

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def run_gate(self, *args, entry=ENTRY, cwd=None):
        return subprocess.run([sys.executable, str(entry), '--root', str(self.root),
                               '--format', 'json', *args], cwd=cwd,
                              capture_output=True, text=True)

    def findings(self):
        result = self.run_gate()
        self.assertIn(result.returncode, (0, 1), result.stderr)
        return result, json.loads(result.stdout)

    def test_approved_exports_and_valid_light_root(self):
        result, findings = self.findings()
        self.assertEqual(result.returncode, 0, findings)
        self.assertFalse(any(f['code'] == 'PDS004' for f in findings))

    def test_vendor_defaults_reject_three_sber_exports(self):
        result = subprocess.run([sys.executable, str(VENDOR), str(self.root),
                                 '--format', 'json'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stderr)
        errors = [f for f in json.loads(result.stdout) if f['code'] == 'PDS004']
        self.assertEqual([(f['path'], f['line']) for f in errors],
                         [('src/auth/sber-tokens.css', n) for n in (7, 8, 9)])

    def test_arbitrary_colors_rejected(self):
        for path, text in (
            ('src/ordinary.css', '.arbitrary { color: #fff; }'),
            ('src/Component.tsx', "import {Box} from '@primer/react'; export const C = () => <Box sx={{color: '#fff'}} />"),
            ('src/other/sber-tokens.css', ':root { --sber-button-rest: #21a038; }'),
            ('src/other/forum-tokens.css', ':root { --forum-arbitrary: #fff; }'),
            ('src/auth/sber-tokens.css', '.arbitrary { color: #fff; }')):
            with self.subTest(path=path):
                self.write(path, text)
                result, findings = self.findings()
                self.assertEqual(result.returncode, 1, findings)
                self.assertTrue(any(f['code'] == 'PDS004' and f['path'] == path for f in findings), findings)
                (self.root / path).unlink()

    def test_full_project_retains_warnings(self):
        result = subprocess.run([sys.executable, str(ENTRY), '--format', 'json'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        findings = json.loads(result.stdout)
        self.assertEqual(sum(f['code'] == 'PDS007' for f in findings), 71)
        self.assertFalse(any(f['severity'] == 'error' for f in findings))

    def test_default_target_independent_of_working_directory(self):
        outputs = [subprocess.run([sys.executable, str(ENTRY), '--format', 'json'],
                                  cwd=cwd, capture_output=True, text=True)
                   for cwd in (REPO, self.temp.name)]
        self.assertEqual([p.returncode for p in outputs], [0, 0])
        self.assertEqual(outputs[0].stdout, outputs[1].stdout)

    def test_invalid_option_and_unreadable_root_fail(self):
        for args in (('--allow-token-file', '**/*.css'), ('--unknown',),
                     ('--root', str(self.root / 'missing'))):
            result = self.run_gate(*args)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(result.stderr)
        self.root.chmod(0)
        self.addCleanup(self.root.chmod, 0o700)
        self.assertNotEqual(self.run_gate().returncode, 0)

    def test_corrupt_or_missing_configuration_and_snapshot_fail(self):
        sandbox = Path(self.temp.name) / 'repo/scripts/verification'
        shutil.copytree(ENTRY.parent / 'primer-ui', sandbox / 'primer-ui')
        shutil.copy2(ENTRY, sandbox / ENTRY.name)
        entry = sandbox / ENTRY.name
        policy = sandbox / 'primer-ui/policy.json'
        vendor = sandbox / 'primer-ui/validate_primer_ui.py'
        original = policy.read_bytes()
        for payload in (b'{', b'{}', json.dumps({**json.loads(original),
                         'allowed_token_paths': ['**/sber-tokens.css']}).encode()):
            with self.subTest(payload=payload):
                policy.write_bytes(payload)
                result = self.run_gate(entry=entry)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(result.stderr)
        policy.write_bytes(original)
        vendor.write_text(vendor.read_text() + '\n# tampered\n')
        result = self.run_gate(entry=entry)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('snapshot', result.stderr)
        vendor.unlink()
        self.assertNotEqual(self.run_gate(entry=entry).returncode, 0)
        policy.unlink()
        self.assertNotEqual(self.run_gate(entry=entry).returncode, 0)


if __name__ == '__main__':
    unittest.main()
