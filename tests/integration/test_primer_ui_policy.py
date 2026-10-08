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

    def test_full_project_has_no_findings(self):
        result = subprocess.run([sys.executable, str(ENTRY), '--format', 'json'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        findings = json.loads(result.stdout)
        self.assertEqual(findings, [])

    def assert_visual_findings(self, source, expected, *, css=False):
        path = 'src/semantic.css' if css else 'src/Semantic.tsx'
        self.write(path, source)
        result, findings = self.findings()
        visual = [f for f in findings if f['code'] == 'PDS007' and f['path'] == path]
        self.assertEqual([(f['line'], f['severity']) for f in visual],
                         [(line, 'warning') for line in expected], findings)
        self.assertEqual(result.returncode, int(any(f['severity'] == 'error' for f in findings)))

    def test_supported_named_aliases_and_literal_expressions(self):
        self.assert_visual_findings("""import {Stack as Layout} from '@primer/react'
import {Card as Panel} from '@primer/react/experimental'
export const Example = () => <Layout gap="normal"><Panel padding="none" borderRadius="medium" /></Layout>
""", [])
        for source in (
            "import{Stack}from'@primer/react';const C=()=> <Stack gap={'normal'} padding={`cozy`} paddingBlock=\"tight\" paddingInline=\"spacious\" />",
            "import * as P from '@primer/react';import * as E from '@primer/react/experimental';const C=()=> <P.Stack gap=\"condensed\"><E.Card padding={'normal'} borderRadius={`large`}/></P.Stack>",
            "import Default,{Stack as S}from'@primer/react'; const C=()=> <S\n gap=\"normal\"\n padding=\"none\"\n />",
        ):
            with self.subTest(source=source):
                self.assert_visual_findings(source, [])

    def test_supported_variant_values(self):
        for prop in ('gap', 'padding', 'paddingBlock', 'paddingInline'):
            for value in ('none', 'tight', 'condensed', 'cozy', 'normal', 'spacious'):
                with self.subTest(component='Stack', prop=prop, value=value):
                    self.assert_visual_findings(f"import {{Stack}} from '@primer/react';const C=()=> <Stack {prop}=\"{value}\"/>", [])
        for prop, values in (('padding', ('none', 'condensed', 'normal')),
                             ('borderRadius', ('medium', 'large'))):
            for value in values:
                with self.subTest(component='Card', prop=prop, value=value):
                    self.assert_visual_findings(f"import {{Card}} from '@primer/react/experimental';const C=()=> <Card {prop}=\"{value}\"/>", [])

    def test_unproven_imports_never_authorize_component_names(self):
        for prefix in (
            '', "import {Stack} from 'another-package';",
            "import type {Stack} from '@primer/react';",
            "import {type Stack} from '@primer/react';",
            "export {Stack} from '@primer/react';",
            "const Stack = Local;",
            "/* import {Stack} from '@primer/react' */",
            "const text = \"import {Stack} from '@primer/react'\";",
            "const text = `import {Stack} from '@primer/react'`;",
            "import {Stack} from '@primer/react/experimental';",
        ):
            with self.subTest(prefix=prefix):
                self.assert_visual_findings(prefix + ' const C=()=> <Stack gap="normal"/>', [1])
        self.assert_visual_findings("import {Card} from '@primer/react';const C=()=> <Card padding=\"none\" borderRadius=\"medium\"/>", [1, 1])

    def test_shadowed_or_reassigned_bindings_remain_unproven(self):
        for declaration in (
            'function C(Layout) { return <Layout gap="normal"/> }',
            'function C({Layout}) { return <Layout gap="normal"/> }',
            'const C = (Layout) => <Layout gap="normal"/>',
            'const C = ({Layout}) => <Layout gap="normal"/>',
            'Layout = Other; const C=()=> <Layout gap="normal"/>',
            'const C=()=> { const Layout=Other; return <Layout gap="normal"/> }',
        ):
            with self.subTest(declaration=declaration):
                self.assert_visual_findings("import {Stack as Layout} from '@primer/react';" + declaration, [1])
        for declaration in (
            'P=Other;const C=()=> <P.Stack gap="normal"/>',
            'P.Stack=Other;const C=()=> <P.Stack gap="normal"/>',
            'function C(P){return <P.Stack gap="normal"/>}',
            'const C=({P})=> <P.Stack gap="normal"/>',
        ):
            with self.subTest(declaration=declaration):
                self.assert_visual_findings("import * as P from '@primer/react';" + declaration, [1])

    def test_unknown_props_values_and_other_components_still_warn(self):
        for source in (
            '<Stack gap="mystery" padding="8px" borderRadius="medium"/>',
            '<Card gap="normal" padding="cozy" borderRadius="small"/>',
            '<Box gap="normal" padding="none" borderRadius="medium"/>',
        ):
            with self.subTest(source=source):
                self.assert_visual_findings("import {Stack,Box} from '@primer/react';import {Card} from '@primer/react/experimental';const C=()=>" + source, [1, 1, 1])
        for source in ('<Stack.Item gap="normal"/>', '<Card.Heading padding="none"/>'):
            with self.subTest(source=source):
                self.assert_visual_findings("import {Stack} from '@primer/react';import {Card} from '@primer/react/experimental';const C=()=>" + source, [1])

    def test_escaped_named_alias_parameters_cannot_prove_imported_component(self):
        for declaration in (
            r'function C(\u004cayout) {return <Layout gap="normal"/>}',
            r'function C(\u{4c}ayout) {return <Layout gap="normal"/>}',
            r'const C=({\u004cayout})=> <Layout gap="normal"/>',
        ):
            with self.subTest(declaration=declaration):
                self.assert_visual_findings("import {Stack as Layout} from '@primer/react';" + declaration, [1])

    def test_lowercase_stack_aliases_render_intrinsic_tags_and_retain_warnings(self):
        for alias in ('div', 'stack', 'xStack'):
            with self.subTest(alias=alias):
                self.assert_visual_findings(f"import {{Stack as {alias}}} from '@primer/react';const C=()=> <{alias} gap=\"normal\"/>", [1])

    def test_lowercase_card_aliases_render_intrinsic_tags_and_retain_warnings(self):
        for alias in ('section', 'card', 'xCard'):
            with self.subTest(alias=alias):
                self.assert_visual_findings(f"import {{Card as {alias}}} from '@primer/react/experimental';const C=()=> <{alias} padding=\"none\" borderRadius=\"medium\"/>", [1, 1])

    def test_same_line_primer_prop_does_not_exempt_intrinsic_alias(self):
        self.assert_visual_findings("import {Stack,Stack as div} from '@primer/react';const C=()=> <><Stack gap=\"normal\"/><div gap=\"normal\"/></>", [1])

    def test_lowercase_namespace_members_are_runtime_component_references(self):
        self.assert_visual_findings("import * as p from '@primer/react';import * as e from '@primer/react/experimental';const C=()=> <p.Stack gap=\"normal\"><e.Card padding=\"none\" borderRadius=\"medium\"/></p.Stack>", [])

    def test_escaped_namespace_parameters_cannot_prove_imported_component(self):
        for declaration in (
            r'function C(\u0050) {return <P.Stack gap="normal"/>}',
            r'function C(\u{50}) {return <P.Stack gap="normal"/>}',
            r'const C=({\u0050})=> <P.Stack gap="normal"/>',
        ):
            with self.subTest(declaration=declaration):
                self.assert_visual_findings("import * as P from '@primer/react';" + declaration, [1])

    def test_unicode_escape_lookalikes_in_comments_and_strings_do_not_invalidate_import(self):
        for prefix in (
            r'/* function C(\u004cayout) {} */',
            r'const example="\u004cayout";',
            r'const example=`\u004cayout`;',
        ):
            with self.subTest(prefix=prefix):
                self.assert_visual_findings("import {Stack as Layout} from '@primer/react';" + prefix + 'const C=()=> <Layout gap="normal"/>', [])

    def test_same_line_props_do_not_authorize_style_sx_or_another_component(self):
        for source in (
            '<Stack gap="normal" style={{gap: "8px", padding: "none"}}/>',
            '<Stack gap="normal" sx={{gap: "8px", padding: "none"}}/>',
            '<><Stack gap="normal"/><Box gap="normal" padding="8px"/></>',
            '<><Box gap="normal"/><Stack gap="normal"/><Box padding="8px"/></>',
        ):
            with self.subTest(source=source):
                self.assert_visual_findings("import {Stack,Box} from '@primer/react';const C=()=>" + source, [1, 1])

    def test_css_auto_and_zero_complete_shorthands(self):
        self.assert_visual_findings(""".center { margin-inline: auto; margin: 0 auto; }
.reset { padding-inline: 0; margin: 0; gap: 0; border-radius: 0; }
""", [], css=True)
        for declaration in (
            'margin: 0 auto 0 auto', 'margin: auto', 'margin-inline: auto 0',
            'margin-block: 0 auto', 'margin-top: auto', 'padding: 0 0 0 0',
            'padding-inline: 0 0', 'padding-block: 0 0', 'padding-left: 0',
            'gap: 0 0', 'row-gap: 0', 'column-gap: 0', 'border-radius: 0 0 0 0',
            'margin: 0 auto !important', 'padding: 0 !important',
            'margin: 0 /* real comment */ auto',
        ):
            with self.subTest(declaration=declaration):
                self.assert_visual_findings('.a {' + declaration + ';}', [], css=True)

    def test_css_invalid_values_and_shorthand_lengths_still_warn(self):
        for declaration in (
            'margin: 0 auto 0 auto 0', 'margin-inline: 0 auto 0', 'margin-top: 0 auto',
            'padding: 0 0 0 0 0', 'padding-inline: 0 0 0', 'padding-left: 0 0',
            'gap: 0 0 0', 'row-gap: 0 0', 'column-gap: 0 0',
            'border-radius: 0 0 0 0 0', 'border-radius: 0 / 0',
            'padding: auto', 'gap: auto', 'border-radius: auto', 'box-shadow: 0',
            'margin: 0 8px', 'padding: 0 unknown', 'margin: "auto"',
            'margin: calc(0)', 'padding: 0px', 'gap: -0',
            'margin: 0 auto !important invalid', 'padding: auto !important',
        ):
            with self.subTest(declaration=declaration):
                self.assert_visual_findings('.a {' + declaration + ';}', [1], css=True)

    def test_css_same_line_valid_occurrences_do_not_hide_invalid_ones(self):
        for source in (
            '.a {margin: 0 auto; padding: 8px; padding: auto; gap: 0; box-shadow: 0;}',
            '.a {padding: 8px; margin: 0 auto; padding: auto; box-shadow: 0; gap: 0;}',
            '.a {content: "margin: 0 auto"; padding: 8px;} /* margin: 0 auto; */ .b{padding:auto;box-shadow:0;}',
        ):
            with self.subTest(source=source):
                self.assert_visual_findings(source, [1, 1, 1], css=True)

    def test_color_and_typography_rules_survive_accepted_visual_props(self):
        self.write('src/Semantic.tsx', "import {Stack} from '@primer/react';const C=()=> <Stack gap=\"normal\" style={{color:'#fff',fontSize:'14px'}}/>")
        result, findings = self.findings()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(sorted(f['code'] for f in findings if f['path'] == 'src/Semantic.tsx'), ['PDS004', 'PDS005'])

    def test_upstream_snapshot_retains_visual_warnings_including_cabinet_props(self):
        result = subprocess.run([sys.executable, str(VENDOR), str(REPO / 'apps/web'),
                                 '--format', 'json',
                                 '--allow-token-file', 'src/home/forum-tokens.css',
                                 '--allow-token-file', 'src/audience/forum-tokens.css',
                                 '--allow-token-file', 'src/auth/sber-tokens.css'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        findings = json.loads(result.stdout)
        # Removing the registration action also removes one valid Stack gap.
        # The pinned upstream scanner still warns on 72 accepted props; our
        # narrow semantic binding gate accepts them, including both cabinet gaps.
        self.assertEqual(len(findings), 72)
        self.assertEqual(sum(f['path'] == 'src/home/Cabinet.tsx' for f in findings), 2)
        self.assertTrue(all(f['code'] == 'PDS007' and f['severity'] == 'warning' for f in findings))

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
