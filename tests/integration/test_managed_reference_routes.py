"""All managed directories are independently owned pages of a dev artifact."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from scripts.deployment.web_release import validate_artifact

spec=importlib.util.spec_from_file_location('managed_routes_fixture',Path(__file__).with_name('test_role_web_routes.py'))
fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)
KINDS=['regions','offer-types','business-segments','commercial-roles','units','rejection-reasons','company-statuses']
ROUTES=fixtures.ROUTES+['/cabinet/references/okved/','/cabinet/references/okpd/']+['/cabinet/references/'+kind+'/' for kind in KINDS]
class ManagedReferenceRoutes(unittest.TestCase):
 def test_all_seven_pages_are_owned(self):
  with tempfile.TemporaryDirectory() as root:
   artifact=fixtures.RoleWebRoutes().artifact(root,ROUTES)
   _,pages=validate_artifact(artifact,'a'*40,'dev')
   self.assertEqual(len(pages),20)
   for kind in KINDS:self.assertIn('cabinet/references/'+kind+'/index.html',pages)
 def test_partial_managed_inventory_is_rejected(self):
  with tempfile.TemporaryDirectory() as root:
   artifact=fixtures.RoleWebRoutes().artifact(root,ROUTES[:-1])
   with self.assertRaisesRegex(ValueError,'Route inventory mismatch'):validate_artifact(artifact,'a'*40,'dev')
