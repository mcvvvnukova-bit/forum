"""A complete read-only directory artifact is accepted before publication."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from scripts.deployment.web_release import validate_artifact

spec = importlib.util.spec_from_file_location('role_routes_fixture', Path(__file__).with_name('test_role_web_routes.py'))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)

class OkvedWebRoutes(unittest.TestCase):
    def test_okved_route_is_owned_by_the_artifact(self):
        with tempfile.TemporaryDirectory() as root:
            artifact = fixtures.RoleWebRoutes().artifact(root, fixtures.ROUTES + ['/cabinet/references/okved/'])
            _, pages = validate_artifact(artifact, 'a' * 40, 'dev')
            self.assertIn('cabinet/references/okved/index.html', pages)
