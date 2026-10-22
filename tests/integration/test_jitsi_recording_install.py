import importlib.util
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("recording_install", ROOT / "deployment/jitsi-recording/install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class RecordingInstallTests(unittest.TestCase):
    def test_updates_managed_settings_without_changing_jwt_or_unknown_values(self):
        original = "# private\nJWT_APP_SECRET=retain-this\nENABLE_RECORDING=0\nCUSTOM=kept\nENABLE_RECORDING=0\n"
        actual = installer.merge_env(original, {"ENABLE_RECORDING": "1", "JIBRI_RECORDING_FRAMERATE": "15"})
        self.assertEqual(actual, "# private\nJWT_APP_SECRET=retain-this\nENABLE_RECORDING=1\nCUSTOM=kept\nJIBRI_RECORDING_FRAMERATE=15\n")
        self.assertEqual(installer.merge_env(actual, {"ENABLE_RECORDING": "1", "JIBRI_RECORDING_FRAMERATE": "15"}), actual)

    def test_refuses_active_or_unknown_calls_before_writing_any_file(self):
        for stats in [{"conferences": 1, "participants": 1}, {"conferences": 0, "participants": 1}, {}]:
            with self.subTest(stats=stats), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp) / "jitsi"
                root.mkdir()
                (root / ".env").write_text("JWT_APP_SECRET=original\n")
                with self.assertRaisesRegex(RuntimeError, "conference"):
                    installer.prepare(root, ROOT / "deployment/jitsi-recording", Path(tmp) / "service", Path(tmp) / "backups", stats)
                self.assertEqual((root / ".env").read_text(), "JWT_APP_SECRET=original\n")
                self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["jitsi"])

    def test_retains_original_configuration_in_a_private_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "jitsi"
            root.mkdir()
            original = "JWT_APP_SECRET=original\nCONFIG=/var/lib/jitsi-meet\n"
            (root / ".env").write_text(original)
            report = installer.prepare(root, ROOT / "deployment/jitsi-recording", Path(tmp) / "service", Path(tmp) / "backups", {"conferences": 0, "participants": 0})
            backup = Path(report["backup"])
            self.assertEqual((backup / ".env").read_text(), original)
            self.assertEqual((backup / ".env").stat().st_mode & 0o777, 0o600)
            self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
            self.assertIn("ENABLE_RECORDING=1\n", (root / ".env").read_text())
            self.assertTrue((root / "recording.override.yaml").is_file())
            self.assertTrue((Path(tmp) / "service/finalize.sh").is_file())


if __name__ == "__main__":
    unittest.main()
