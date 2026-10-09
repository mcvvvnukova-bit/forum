#!/usr/bin/env python3
"""Validate selected operational source offline; never invoke its administrators."""
import ast
from functools import lru_cache
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
RUBY = 'openproject/openproject@sha256:8e49371d8d2aa5b92a40231687076fa3eaa2c98ff1f4f1789e1fe9da5fd838f9'
CADDY = 'caddy@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d'


def run(*argv, cwd=ROOT):
    result = subprocess.run(argv, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f'{argv[0]} validation failed: {result.stderr}')
    return result.stdout


# Task7 is a new explicit current-ownership layer. Task4 source pins and Task5/6
# snapshots remain byte-identical; no previous dated proof is rewritten.
@lru_cache(maxsize=1)
def task7_receipt():
    receipt_path = ROOT / 'artifacts/repository-audits/task-7-source-ownership.json'
    if not receipt_path.exists():
        return None
    receipt = json.loads(receipt_path.read_text())
    assert receipt['baseSha'] == 'a56b52ed05a5f1fbe267dafcfe5d41ce1042916b'
    changes = receipt['changes']
    assert len({item['previousCandidatePath'] for item in changes}) == len(changes), 'Duplicate Task7 ownership'
    explicit = {'apps/api/Dockerfile', 'package.json', 'package-lock.json', '.github/workflows/quality.yml',
                'vitest.composition.config.ts', 'README.md', 'deployment/release.md',
                'deployment/release-manifest.schema.json', 'scripts/deployment/public_site.py',
                'scripts/verification/check-built-public-site.py',
                'scripts/verification/check-operational-sources.py',
                'scripts/verification/check-repository-layout.mjs',
                'scripts/verification/repository-layout.json', 'scripts/verification/checks.test.mjs',
                'scripts/verification/quality-gate.mjs', 'tests/integration/public-site-composition.test.tsx',
                'tests/integration/README.md',
                # Final Task7/8 ownership closure: retire the fourth publisher.
                'scripts/deployment/legacy-landing/deploy.sh',
                'apps/legacy-landing/README.md',
                'apps/legacy-landing/tests/test_deploy_rollback.py'}
    for item in changes:
        old = item['previousCandidatePath']
        assert old in explicit or old.startswith(('apps/primer-home/', 'apps/audience-pages/', 'apps/public-auth/')), 'Out-of-scope Task7 ownership'
        new = Path(item['candidatePath'])
        assert not new.is_absolute() and '..' not in new.parts, 'Unsafe Task7 owner'
        assert str(new) in explicit or str(new).startswith(('apps/web/', 'apps/primer-home/', 'apps/audience-pages/', 'apps/public-auth/', 'scripts/deployment/build-web-release')), 'Out-of-scope Task7 replacement'
    return receipt


def current_file(candidate, expected_hash, expected_mode):
    receipt = task7_receipt()
    if receipt is None:
        return ROOT / candidate, expected_hash, expected_mode
    change = next((item for item in receipt['changes'] if item['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'Task7 baseline pin mismatch: ' + candidate
        resolved = (change['candidatePath'], change['candidateSha256'], change['candidateMode'])
    else:
        resolved = (candidate, expected_hash, expected_mode)
    return public_entry_file(*governance_file(*resolved))


# Preserve all dated predecessor receipts. This task can replace only these
# existing public entry and verification files, without moving or chmod'ing them.
PUBLIC_ENTRY_PATHS = {
    'apps/web/src/audience/App.tsx', 'apps/web/src/audience/audience.test.tsx',
    'apps/web/src/auth/PublicAuth.tsx', 'apps/web/src/home/config.ts',
    'apps/web/src/home/home.test.tsx', 'packages/public-navigation.ts',
    'deployment/web/build-config.json', 'deployment/release-manifest.schema.json',
    'scripts/deployment/web_release.py', 'tests/e2e/public-site.spec.ts',
    'tests/integration/public-site-composition.test.tsx', 'vitest.composition.config.ts',
    'scripts/verification/check-operational-sources.py', 'scripts/verification/checks.test.mjs',
}


@lru_cache(maxsize=1)
def public_entry_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-31-public-entry-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-31'
    assert receipt['baseSha'] == '36277f1094a6514709b2bf5eb6c9737c9361a213', 'PROJ-31 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(PUBLIC_ENTRY_PATHS), 'Duplicate or missing PROJ-31 owner'
    assert {item['previousCandidatePath'] for item in changes} == PUBLIC_ENTRY_PATHS, 'Out-of-scope PROJ-31 owner'
    for item in changes:
        assert item['candidatePath'] == item['previousCandidatePath'], 'PROJ-31 owner cannot move'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-31 mode must stay unchanged'
        for key in ('previousSha256', 'candidateSha256'):
            assert len(item[key]) == 64 and all(c in '0123456789abcdef' for c in item[key]), 'Invalid PROJ-31 hash'
    return receipt


def public_entry_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((item for item in public_entry_receipt()['changes'] if item['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-31 predecessor pin mismatch: ' + candidate
        return sber_auth_file(ROOT / candidate, change['candidateSha256'], change['candidateMode'])
    return sber_auth_file(ROOT / candidate, expected_hash, expected_mode)


SBER_AUTH_PATHS = {
    'apps/api/README.md', 'apps/api/src/iam/auth-store.ts', 'apps/api/src/iam/auth.controller.ts',
    'apps/api/src/migrate.ts', 'apps/api/test/auth.test.ts', 'apps/api/test/browser-smoke.mjs',
    'apps/web/src/audience/intent.ts', 'apps/web/src/auth/PublicAuth.test.tsx',
    'apps/web/src/auth/PublicAuth.tsx', 'apps/web/src/home/App.tsx', 'apps/web/src/home/home.test.tsx',
    'tests/e2e/public-site.spec.ts', 'scripts/verification/check-operational-sources.py',
    'scripts/verification/checks.test.mjs', 'tests/integration/test_primer_ui_policy.py',
}
SBER_AUTH_NEW_PATHS = {
    'apps/api/migrations/004_individual_role.sql', 'apps/web/src/home/Cabinet.tsx',
    'docs/plans/2026-10-08-PROJ-155-sber-unified-auth.md',
}


@lru_cache(maxsize=1)
def sber_auth_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-155-sber-auth-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-155'
    assert receipt['baseSha'] == '49241fd9fd8b5a733c5ef7350766c9c8650dc744', 'PROJ-155 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(SBER_AUTH_PATHS) and {x['previousCandidatePath'] for x in changes} == SBER_AUTH_PATHS, 'Out-of-scope PROJ-155 owner'
    for item in changes:
        assert item['candidatePath'] == item['previousCandidatePath'], 'PROJ-155 owner cannot move'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-155 mode must stay unchanged'
        for key in ('previousSha256', 'candidateSha256'):
            assert len(item[key]) == 64 and all(c in '0123456789abcdef' for c in item[key]), 'Invalid PROJ-155 hash'
    sources = receipt['newFiles']
    assert len(sources) == len(SBER_AUTH_NEW_PATHS) and {x['path'] for x in sources} == SBER_AUTH_NEW_PATHS, 'Out-of-scope PROJ-155 source'
    for item in sources:
        source, digest, _ = logout_home_file(ROOT / item['path'], item['sha256'], item['mode'])
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, 'PROJ-155 source hash mismatch: ' + item['path']
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-155 source mode mismatch'
    return receipt


def sber_auth_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((x for x in sber_auth_receipt()['changes'] if x['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-155 predecessor pin mismatch: ' + candidate
        return main_auth_file(ROOT / candidate, change['candidateSha256'], change['candidateMode'])
    return main_auth_file(ROOT / candidate, expected_hash, expected_mode)


# Exact-path PROJ-156 successor. Historical receipts are never rewritten.
MAIN_AUTH_PREDECESSORS = {'apps/api/README.md': 'a10db49c8291fa91f370a87c122bc622cb33fc2e0bcfb681f468a266e4d182c5', 'apps/api/src/app.ts': 'ce1b222c87830245d82178deea625f357cb9655674754e9d15449a9761d6ccc9', 'apps/api/src/iam/auth-store.ts': 'bb5155f1585ac209e5814074563ab9cc4a9a5931af9ae85f5ab339ac833b9840', 'apps/api/src/migrate.ts': '533b805fbd9e48e3cbfa0f28a16b12e23f042443552f312b2676f0e73b20d931', 'apps/api/src/party/individual-participant.ts': '1c084c9fc90293710a0c914292825bcc10dba1db6cf7574c65a29b94e658cc74', 'apps/api/test/auth.test.ts': '7a8dbf9be714b3b2e5f96e77fcdde7b5e9ce03c27365dbf61a21feceac86dda6', 'apps/api/test/browser-smoke.mjs': '4ba78089e73fe00197b201eeeddda0896047c7f60c17ab67d67312527b6b17e1', 'apps/api/test/migrate.test.ts': '6f224d2ec4d2e96ad330ea937901a3943ed52cc7275697ff9dbddb8dec04df52', 'deployment/forum-db/README.md': '365a2557150ec22de4ad8e9bd13b9e4e3a35ad3b80272f3b2fbd014d04b1cf74', 'scripts/verification/check-operational-sources.py': 'c5b192ab893ace0bcb765af3384f32d0c01212486d5b95b8d44448d4c0c15384', 'scripts/verification/checks.test.mjs': '164486026f2c52129a64821e35d86bfce1fc9d43ea5afeb57336c296b7bd03e6'}
MAIN_AUTH_NEW_PATHS = {'apps/api/test/consolidation.test.ts', 'deployment/forum-db/export-legacy-auth.psql', 'apps/api/src/consolidate-auth.ts', 'docs/plans/2026-10-08-gitnexus-plan-main-forum-auth-migration.md', 'apps/api/migrations/005_public_individual_role.sql'}


@lru_cache(maxsize=1)
def main_auth_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-156-main-auth-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-156'
    assert receipt['baseSha'] == 'f0a8d54f3a1d293b218ed9f7cb220b18929960b4', 'PROJ-156 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(MAIN_AUTH_PREDECESSORS) and {x['previousCandidatePath'] for x in changes} == set(MAIN_AUTH_PREDECESSORS), 'Out-of-scope PROJ-156 owner'
    for item in changes:
        path = item['previousCandidatePath']
        assert item['candidatePath'] == path and item['previousSha256'] == MAIN_AUTH_PREDECESSORS[path], 'PROJ-156 predecessor mismatch'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-156 mode mismatch'
        assert len(item['candidateSha256']) == 64 and all(c in '0123456789abcdef' for c in item['candidateSha256']), 'Invalid PROJ-156 hash'
    sources = receipt['newFiles']
    assert len(sources) == len(MAIN_AUTH_NEW_PATHS) and {x['path'] for x in sources} == MAIN_AUTH_NEW_PATHS, 'Out-of-scope PROJ-156 source'
    for item in sources:
        source, digest, _ = person_memberships_file(ROOT / item['path'],item['sha256'],item['mode'])
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, 'PROJ-156 source hash mismatch'
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-156 source mode mismatch'
    return receipt


def main_auth_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((x for x in main_auth_receipt()['changes'] if x['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-156 chain mismatch: ' + candidate
        return login_entry_file(ROOT / candidate, change['candidateSha256'], change['candidateMode'])
    return login_entry_file(ROOT / candidate, expected_hash, expected_mode)


# PROJ-157 retires the registration page without rewriting previous receipts.
LOGIN_ENTRY_PREDECESSORS = {'tests/integration/test_primer_ui_policy.py': '77921cf099399cde0527fc6d2922bc81fa0eb941e96e20ff6010894ed5b09521', 'apps/web/README.md': '23e30f5c96e8b623de6856e848ce0aed224e226fa977b5e454b8a9293b7e2c9e', 'apps/dev-gateway/forum_dev_auth.py': '6d45b1ce43fbd8405d58de052dc5e5c5d152d2434351d9baf1629ae97eead1c3', 'apps/legacy-landing/tests/test_auth_gateway.py': '140836d2f34751b89b3ddd276ac6d515490d686074f961d48898b1e70ad1d3ca', 'apps/web/src/App.test.tsx': '9ad1b11f3d354be35435576da8ec92f5179c464ffef45e91ca7528b0e6ea1c5f', 'apps/web/src/App.tsx': '030effa81e9ff3b334b946003cdd4917234757bd9fe4ce11beb32080ee2a3f13', 'apps/web/src/audience/App.tsx': '94fc764dcb4bd9300538145b50cff84e5c9ba8238c68978dc70e888fd8c8d3fd', 'apps/web/src/audience/Participation.tsx': '1c56a916c9fd31a2ffd5382f7c7661239f11efebf03761ed1cc6a4328cae399e', 'apps/web/src/audience/audience.test.tsx': '0a0eda5a1b78f87e5efa8b21bf9617f1958ab84b5371b15c241b75c5febfab53', 'apps/web/src/audience/config.ts': '04a7f952c1144b4a458a84d9c27d65d20d89584f061ea1f433d7d3b421b31731', 'apps/web/src/auth/PublicAuth.test.tsx': '58bc26881f5bb8a22823b2feeadf50f163372d900fd71c0a41f28c8134928103', 'apps/web/src/auth/PublicAuth.tsx': 'dcc0a5f465bfe347fd4a5b9a9fe82753fd43588bc8fb76cdd798fb164fafa0c5', 'apps/web/src/home/AuthNotice.tsx': '178e654377037475aae81cb6e17a8a0da604b497abf74b1fdce01d03c237a053', 'apps/web/src/home/home.test.tsx': '7c952a9eacf79bdb36323dca951b04e07bf8b91ec70e3d6026f8185f1db868ff', 'deployment/release-manifest.schema.json': '3b01b7f89bd0e70bcb3af4279d70b6f692892a289b0472701def9ccb80623ca8', 'packages/public-navigation.ts': 'd37db7b0d1c9b615c4b444e2942fcb0911f3bbe1842d00a2f4137c4fb024be78', 'scripts/deployment/build-web-release.mjs': '045b17b3d7635565cadee0f296da1a86a81f60f19838eee0e15ef01445988c73', 'scripts/deployment/web_release.py': '813230c302550f49ba86651317cb4e0bbee890bb4026767d5378c6ee4506589e', 'scripts/verification/check-operational-sources.py': '252a29ea3c19a38fc65860619116ef8baf77b2abff8a7b45c2842b2a2ff38ba8', 'scripts/verification/checks.test.mjs': '086877fbe5f865cd192bbc4209ba8fe061976341fc5a04b5574e5dd5a872367f', 'tests/e2e/public-site.spec.ts': '991b2c85c70755a86a1e7588992128543199debb6d9fae95955c832f5addcd10', 'tests/integration/public-site-composition.test.tsx': '5c1f97740e2bc475f39dd377d823ece10c61feadd4b5790dc7f00150709b63f5', 'tests/integration/test_web_release.py': 'd9ef6d440062f2a9a07ac7e91d6bb41f8eec5fa12c7f923a8a0b8d1d5e54e980'}
LOGIN_ENTRY_NEW_PATHS = {'docs/plans/2026-10-08-gitnexus-plan-unified-login-entry.md'}


@lru_cache(maxsize=1)
def login_entry_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-157-login-entry-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-157'
    assert receipt['baseSha'] == '92e7de0c227de01ecf194aeb57d3713950ed5db1', 'PROJ-157 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(LOGIN_ENTRY_PREDECESSORS) and {x['previousCandidatePath'] for x in changes} == set(LOGIN_ENTRY_PREDECESSORS), 'Out-of-scope PROJ-157 owner'
    for item in changes:
        path = item['previousCandidatePath']
        assert item['candidatePath'] == path and item['previousSha256'] == LOGIN_ENTRY_PREDECESSORS[path], 'PROJ-157 predecessor mismatch'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-157 mode mismatch'
        assert len(item['candidateSha256']) == 64 and all(c in '0123456789abcdef' for c in item['candidateSha256']), 'Invalid PROJ-157 hash'
    sources = receipt['newFiles']
    assert len(sources) == len(LOGIN_ENTRY_NEW_PATHS) and {x['path'] for x in sources} == LOGIN_ENTRY_NEW_PATHS, 'Out-of-scope PROJ-157 source'
    for item in sources:
        source = ROOT / item['path']
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == item['sha256'], 'PROJ-157 source hash mismatch'
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-157 source mode mismatch'
    return receipt


def login_entry_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((x for x in login_entry_receipt()['changes'] if x['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-157 chain mismatch: ' + candidate
        return provider_button_file(ROOT / candidate, change['candidateSha256'], change['candidateMode'])
    return provider_button_file(ROOT / candidate, expected_hash, expected_mode)


# PROJ-158 adds only local provider disabled styling and its regression evidence.
PROVIDER_BUTTON_PREDECESSORS = {'apps/web/src/auth/auth.css': 'dfc6756b17d1cf4115838451c84b5270326ab33b7b4c9bcbe03b378162ded57a', 'tests/e2e/public-site.spec.ts': 'e053231ee88d91d06a328531592bcbed3507c6f072cc9ff746f5bafd416a32b1', 'scripts/verification/check-operational-sources.py': 'e13ba31013ef5bd5dc1973515c88b0b205bbba81bf5c36e7f1dde9fe70848303', 'scripts/verification/checks.test.mjs': 'ab7b1373d4feeb2f8dcf9f9a8a634f53633e37846da901b4e3a72866861f3ff4'}
PROVIDER_BUTTON_NEW_PATHS = {'docs/plans/2026-10-08-sber-disabled-button.md'}


@lru_cache(maxsize=1)
def provider_button_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-158-sber-button-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-158'
    assert receipt['baseSha'] == '7e686ffc0bdc56ca6d72f27ec69349d6949a887f', 'PROJ-158 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(PROVIDER_BUTTON_PREDECESSORS) and {x['previousCandidatePath'] for x in changes} == set(PROVIDER_BUTTON_PREDECESSORS), 'Out-of-scope PROJ-158 owner'
    for item in changes:
        path = item['previousCandidatePath']
        assert item['candidatePath'] == path and item['previousSha256'] == PROVIDER_BUTTON_PREDECESSORS[path], 'PROJ-158 predecessor mismatch'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-158 mode mismatch'
        assert len(item['candidateSha256']) == 64 and all(c in '0123456789abcdef' for c in item['candidateSha256']), 'Invalid PROJ-158 hash'
    sources = receipt['newFiles']
    assert len(sources) == len(PROVIDER_BUTTON_NEW_PATHS) and {x['path'] for x in sources} == PROVIDER_BUTTON_NEW_PATHS, 'Out-of-scope PROJ-158 source'
    for item in sources:
        source = ROOT / item['path']
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == item['sha256'], 'PROJ-158 source hash mismatch'
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-158 source mode mismatch'
    return receipt


def provider_button_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((x for x in provider_button_receipt()['changes'] if x['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-158 chain mismatch: ' + candidate
        return skip_link_file(ROOT / candidate, change['candidateSha256'], change['candidateMode'])
    return skip_link_file(ROOT / candidate, expected_hash, expected_mode)


# PROJ-159 removes only the shared public skip link and its CSS.
SKIP_LINK_PREDECESSORS = {'apps/web/src/audience/SharedLayout.tsx': '2f38e56b2b3f65309e8878f70d0f077b526d72c8e4edddfb6aff85edd3cccc8d', 'apps/web/src/audience/layout.css': '5845c782969970ee0d9be9124a628454130d2d546d9b0305af1ac3642be021b4', 'apps/web/src/home/SharedLayout.tsx': '17cc498bb4c65c0193812105a009a3aaa72538faa8b95d99ec618fc82084e081', 'apps/web/src/home/layout.css': 'd9acb62f164beb4865790059d3b90b79758dc6182fef2d70753e44ccb6d2e6b8', 'scripts/verification/check-operational-sources.py': '624ff27e719fde958c8597bc662fff89d1462262a39941efe75b659970e6bac3', 'scripts/verification/checks.test.mjs': '4dd1abe28c1163b1dff11e56eca0cd16c864c608c207d990aca61bd7150087e8'}
SKIP_LINK_NEW_PATHS = {'docs/plans/2026-10-08-remove-public-skip-link.md'}


@lru_cache(maxsize=1)
def skip_link_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-159-skip-link-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-159'
    assert receipt['baseSha'] == '069932594b6c1b19c7e0d4e28f8fd821f717029e', 'PROJ-159 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(SKIP_LINK_PREDECESSORS) and {x['previousCandidatePath'] for x in changes} == set(SKIP_LINK_PREDECESSORS), 'Out-of-scope PROJ-159 owner'
    for item in changes:
        path = item['previousCandidatePath']
        assert item['candidatePath'] == path and item['previousSha256'] == SKIP_LINK_PREDECESSORS[path], 'PROJ-159 predecessor mismatch'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-159 mode mismatch'
        assert len(item['candidateSha256']) == 64 and all(c in '0123456789abcdef' for c in item['candidateSha256']), 'Invalid PROJ-159 hash'
    sources = receipt['newFiles']
    assert len(sources) == len(SKIP_LINK_NEW_PATHS) and {x['path'] for x in sources} == SKIP_LINK_NEW_PATHS, 'Out-of-scope PROJ-159 source'
    for item in sources:
        source = ROOT / item['path']
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == item['sha256'], 'PROJ-159 source hash mismatch'
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-159 source mode mismatch'
    return receipt


def skip_link_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((x for x in skip_link_receipt()['changes'] if x['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-159 chain mismatch: ' + candidate
        return logout_home_file(ROOT / candidate, change['candidateSha256'], change['candidateMode'])
    return logout_home_file(ROOT / candidate, expected_hash, expected_mode)


# PROJ-38 replaces the guest cabinet with the existing public homepage.
LOGOUT_HOME_PREDECESSORS = {'apps/web/src/home/Cabinet.tsx': 'a11c08e19d627bf89559f8dced55cd4a52203720a2e766e986066efb6c786daa', 'apps/web/src/home/home.test.tsx': 'de874ce0d3f20056f9cbb3581428e8ba84fa44d434cd35d52f6c4d7c0191b4af', 'tests/e2e/public-site.spec.ts': 'bef37e8f613c3d270c660ee25210e4b73d43eea871fec00b33febfac21ce0b09', 'scripts/verification/check-operational-sources.py': 'a5912850eff842df56c66fbb92f844fc87333f7141371f71167da12730c678b2', 'scripts/verification/checks.test.mjs': '8d7abdf614227301856cb15b11e93af30a2303f5efaf80b0ab5a06c906e5fd42'}
LOGOUT_HOME_NEW_PATHS = {'docs/plans/2026-10-08-logout-home-design.md', 'docs/plans/2026-10-08-logout-home-plan.md'}


@lru_cache(maxsize=1)
def logout_home_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-38-logout-home-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-38'
    assert receipt['baseSha'] == '89342c05c5d64c2ce83d90b7df84e0677927becb', 'PROJ-38 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(LOGOUT_HOME_PREDECESSORS) and {x['previousCandidatePath'] for x in changes} == set(LOGOUT_HOME_PREDECESSORS), 'Out-of-scope PROJ-38 owner'
    for item in changes:
        path = item['previousCandidatePath']
        assert item['candidatePath'] == path and item['previousSha256'] == LOGOUT_HOME_PREDECESSORS[path], 'PROJ-38 predecessor mismatch'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-38 mode mismatch'
        assert len(item['candidateSha256']) == 64 and all(c in '0123456789abcdef' for c in item['candidateSha256']), 'Invalid PROJ-38 hash'
    sources = receipt['newFiles']
    assert len(sources) == len(LOGOUT_HOME_NEW_PATHS) and {x['path'] for x in sources} == LOGOUT_HOME_NEW_PATHS, 'Out-of-scope PROJ-38 source'
    for item in sources:
        source = ROOT / item['path']
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == item['sha256'], 'PROJ-38 source hash mismatch'
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-38 source mode mismatch'
    return receipt


def logout_home_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((x for x in logout_home_receipt()['changes'] if x['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-38 chain mismatch: ' + candidate
        return cabinet_profile_file(ROOT / candidate, change['candidateSha256'], change['candidateMode'])
    return cabinet_profile_file(ROOT / candidate, expected_hash, expected_mode)


# PROJ-161 owns the exact final task diff from PR30 without rewriting receipts.

# PROJ-163 owns only the settings route, its protected API and verification.
# Historical receipts remain immutable; these pins resolve their final owners.
CABINET_SETTINGS_PREDECESSORS = {'apps/api/README.md': ('d1fd862c6245c92bcb639087d3f2a1e7407d58e07e3bb0d36026ce1e430e9e21', '100644'), 'apps/api/src/app.ts': ('050e327353cbe920601894e7adda74582b00b5fce2e4d5c76a719c29fd751c5f', '100644'), 'apps/dev-gateway/forum_dev_auth.py': ('c88c6729652613ae92b2bce4dd43954826b76e255593e48db3086c52b685fffa', '100644'), 'apps/legacy-landing/tests/test_auth_gateway.py': ('bb1a42cfed0b8f447d94039c30a4de3ea79580e032ffa138735578690970ad72', '100644'), 'apps/profile-preview/src/ProfilePage.tsx': ('3d91e55258c56e5cfcb14d1461c2a343261e88cf1b13c0cc84ba41ce00fac52f', '100644'), 'apps/web/src/home/App.tsx': ('f558a815f42f23f74f2c917cc265a49d240dd7290f0b943ad153fc6134d9f9f8', '100644'), 'apps/web/src/home/Cabinet.tsx': ('e93e6188ba580c0ef19568697ec914a8988a5307fde5fa9e6c0999d973f0872a', '100644'), 'deployment/release-manifest.schema.json': ('7e0c4ba0a2c749fc2e1c1656b112acceaa2b1ebab44d310d0910c53611d78318', '100644'), 'scripts/deployment/build-web-release.mjs': ('42ed103cbe8604869dcbd1fa07fe995951ee40d87ca74e108df2294ac3262c91', '100644'), 'scripts/deployment/web_release.py': ('bdb0b1bd626af9e138262e4b669775e4eff9288be30d9f8881221e9377711bd9', '100644'), 'scripts/verification/check-operational-sources.py': ('67e3640b7c9b5187f934d060d8e9eb0464d7f228565a5e55f4776de933295032', '100644'), 'scripts/verification/checks.test.mjs': ('d26163b9793cef1b4fa81d0f5a76d066a39d84418a5bedac44fa0d8e1301cc51', '100644'), 'scripts/verification/web-build-inputs.test.mjs': ('028c4776a27c27997adcfdae8cabbaf78ae6940cd4bc21968f98d7263915a724', '100644'), 'tests/e2e/public-site.spec.ts': ('a1b9280920896e11bf0e705ff52d17b99aa4e9a0ae377fd8e6050c2f6a721711', '100644'), 'tests/integration/test_primer_ui_policy.py': ('112ef317342f3c9671e9db442de282acf171cb383180fae2d019b399efe317a7', '100644'), 'tests/integration/test_web_release.py': ('021c4627b9ce3eb1074e7f52febe39785e0a96254a826b9e70da17f9187d8176', '100644'), 'apps/web/src/home/cabinet.css': ('771890dc9d0528d7dcb12323888466ce45ceddcbc3cab859deae73250c92a580', '100644'), 'apps/web/src/home/home.test.tsx': ('56ab6f6044e72fdc3232ce9f8e1382376c8b8596430b4371a45669788f1df9b3', '100644')}
CABINET_SETTINGS_NEW_PATHS = {'apps/api/src/iam/settings-store.ts', 'apps/web/src/home/settings.test.tsx', 'apps/api/src/iam/settings.controller.ts', 'docs/plans/2026-10-09-cabinet-settings-design.md', 'docs/plans/2026-10-09-cabinet-settings.md', 'apps/web/src/home/SettingsSection.tsx', 'apps/api/test/settings.test.ts'}


@lru_cache(maxsize=1)
def cabinet_settings_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-163-cabinet-settings-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-163'
    assert receipt['baseSha'] == '033f50fe2b41257e45d586e98f3c3e4b86e8ef67', 'PROJ-163 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(CABINET_SETTINGS_PREDECESSORS) and {x['previousCandidatePath'] for x in changes} == set(CABINET_SETTINGS_PREDECESSORS), 'Out-of-scope PROJ-163 owner'
    for item in changes:
        path = item['previousCandidatePath']
        digest, mode = CABINET_SETTINGS_PREDECESSORS[path]
        assert item['candidatePath'] == path and item['previousSha256'] == digest, 'PROJ-163 predecessor mismatch'
        assert item['previousMode'] == item['candidateMode'] == mode, 'PROJ-163 mode mismatch'
        value = item['candidateSha256']
        assert isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value), 'PROJ-163 invalid digest'
    sources = receipt['newFiles']
    assert len(sources) == len(CABINET_SETTINGS_NEW_PATHS) and {x['path'] for x in sources} == CABINET_SETTINGS_NEW_PATHS, 'Out-of-scope PROJ-163 source'
    for item in sources:
        source = ROOT / item['path']
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == item['sha256'], 'PROJ-163 source hash mismatch: ' + item['path']
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-163 source mode mismatch'
    return receipt


def cabinet_settings_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((x for x in cabinet_settings_receipt()['changes'] if x['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-163 chain mismatch: ' + candidate
        if candidate in MERGED_VERIFICATION_PREDECESSORS:
            assert change['candidateSha256'] == MERGED_VERIFICATION_PREDECESSORS[candidate][0], 'PROJ-163 historical merge pin changed'
        return ci_file(ROOT / candidate, change['candidateSha256'], change['candidateMode'])
    return ci_file(ROOT / candidate, expected_hash, expected_mode)


# Resolve the two verification files changed independently by settings and CI.
# Both historical receipts stay immutable and must retain their exact pins.
MERGED_VERIFICATION_PREDECESSORS = {'scripts/verification/check-operational-sources.py': ('26bef688cff270cd8337a14d70c7024132496ffb8ac91bd852155f61b6be6d11', '489a7d3a33ca9d966804892e84fdfb2994b7732ef7045987f9d27c3de7534a18'), 'scripts/verification/checks.test.mjs': ('f7fca4a3cd7a46923006f92f54f71e4d284044e35b7f0a3d4f123e0a2d625540', '33436986e4a8ecfbadbaa1a157626ee69d1979b9c7ff277634be6a6478741b7a')}


@lru_cache(maxsize=1)
def merged_verification_receipt():
    path = ROOT / 'artifacts/repository-audits/proj-163-main-integration-ownership.json'
    assert path.is_file() and not path.is_symlink(), 'Missing PROJ-163 main integration receipt'
    receipt = json.loads(path.read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-163'
    assert receipt['baseSha'] == '07600076bac07037a5ec22f9405b89d2fbbf7c09', 'PROJ-163 main baseline mismatch'
    assert receipt['headSha'] == 'b87cfb3ac8e2bdfe0d993d7016875c2a3a6ee60d', 'PROJ-163 settings baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(MERGED_VERIFICATION_PREDECESSORS) and {x['previousCandidatePath'] for x in changes} == set(MERGED_VERIFICATION_PREDECESSORS), 'Out-of-scope PROJ-163 main integration owner'
    for item in changes:
        candidate = item['previousCandidatePath']
        settings_hash, ci_hash = MERGED_VERIFICATION_PREDECESSORS[candidate]
        assert item['candidatePath'] == candidate, 'PROJ-163 main integration owner cannot move'
        assert item['previousSha256'] == settings_hash and item['mainSha256'] == ci_hash, 'PROJ-163 main integration predecessor mismatch'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-163 main integration mode mismatch'
        digest = item['candidateSha256']
        assert isinstance(digest, str) and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest), 'Invalid PROJ-163 main integration hash'
        source, digest, _ = sber_profile_file(ROOT / candidate, digest, '100644')
        assert source.is_file() and not source.is_symlink(), candidate
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, 'PROJ-163 main integration hash mismatch: ' + candidate
        assert not source.stat().st_mode & 0o111, 'PROJ-163 main integration source mode mismatch'
    return receipt


def merged_verification_file(path, expected_hash, expected_mode):
    candidate = str(path.relative_to(ROOT))
    if candidate not in MERGED_VERIFICATION_PREDECESSORS:
        return sber_profile_file(path, expected_hash, expected_mode)
    assert expected_hash in MERGED_VERIFICATION_PREDECESSORS[candidate] and expected_mode == '100644', 'PROJ-163 main integration chain mismatch: ' + candidate
    change = next(x for x in merged_verification_receipt()['changes'] if x['previousCandidatePath'] == candidate)
    return sber_profile_file(path, change['candidateSha256'], change['candidateMode'])


# PROJ-166 replaces only its exact current predecessors. Earlier ownership
# receipts remain immutable, including the historical merged verifier pin.
SBER_PROFILE_PREDECESSORS = {'apps/api/README.md': '4a009077e2088eb1bae3ce13d1068d1cd7ce530c25b34c16b380980436a8b8a1', 'apps/api/src/iam/auth-store.ts': '8e644dba361d14298303278263866fd8e27be8747fd1d959d5455ed9964e572e', 'apps/api/src/iam/sber-client.ts': '4c8d6945ddea32bf6a5af98d722a39f72b8ad52b6dce8422719dcfa109453c6a', 'apps/api/test/auth.test.ts': 'a1ce21614bed0b38d77e18bfeb942a48f4db68418295766ca186e5a5260443db', 'apps/api/test/person-memberships.test.ts': 'ec4df2cd6ef3c7ff3997c36f3b7e7a7c0d9cdea366fb74977d6805a01053a2cd', 'apps/api/test/provider-fixture.ts': '0052ee3e3d7d24c468b5aca63912d89b481ca96cf415c90cb2fbe9855927f7b7', 'apps/web/src/home/Cabinet.test.tsx': 'fa2794f0d3ea4410d1b92c36622859d1a2d09bd0aa11bbd852085845a5d82fdc', 'deployment/forum-api/.env.example': '5e0e8f509fc4126cb05ebc4266243075443b1dc4c3d94b23cb0939629b5d1342', 'scripts/verification/check-operational-sources.py': '2f1cb3def5745a1c84cc5b4f2879f1bb430a2717a8103cc7c73d50dfac469759'}
SBER_PROFILE_NEW_PATHS = {'apps/api/src/iam/sber-profile.ts', 'apps/api/test/sber-profile.test.ts'}


@lru_cache(maxsize=1)
def sber_profile_receipt():
    path = ROOT / 'artifacts/repository-audits/proj-166-sber-profile-sync-ownership.json'
    assert path.is_file() and not path.is_symlink(), 'Missing PROJ-166 receipt'
    receipt = json.loads(path.read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-166'
    assert receipt['baseSha'] == '2cdf7d85d96a72eeaa27dc4248623f0255acb784', 'PROJ-166 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(SBER_PROFILE_PREDECESSORS) and {item['previousCandidatePath'] for item in changes} == set(SBER_PROFILE_PREDECESSORS), 'Out-of-scope PROJ-166 owner'
    for item in changes:
        candidate = item['previousCandidatePath']
        assert item['candidatePath'] == candidate and item['previousSha256'] == SBER_PROFILE_PREDECESSORS[candidate], 'PROJ-166 predecessor mismatch'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-166 mode mismatch'
        digest = item['candidateSha256']
        assert isinstance(digest, str) and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest), 'Invalid PROJ-166 digest'
        source = ROOT / candidate
        assert source.is_file() and not source.is_symlink(), candidate
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, 'PROJ-166 source mismatch: ' + candidate
        assert not source.stat().st_mode & 0o111, 'PROJ-166 mode mismatch: ' + candidate
    sources = receipt['newFiles']
    assert len(sources) == len(SBER_PROFILE_NEW_PATHS) and {item['path'] for item in sources} == SBER_PROFILE_NEW_PATHS, 'Out-of-scope PROJ-166 new source'
    for item in sources:
        source = ROOT / item['path']
        assert source.is_file() and not source.is_symlink(), item['path']
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-166 new source mode mismatch'
        assert hashlib.sha256(source.read_bytes()).hexdigest() == item['sha256'], 'PROJ-166 new source mismatch: ' + item['path']
    return receipt


def sber_profile_file(path, expected_hash, expected_mode):
    candidate = str(path.relative_to(ROOT))
    change = next((item for item in sber_profile_receipt()['changes'] if item['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-166 chain mismatch: ' + candidate
        return path, change['candidateSha256'], change['candidateMode']
    return path, expected_hash, expected_mode


CI_PATHS = {
    '.github/workflows/quality.yml', 'scripts/verification/quality-gate.mjs',
    'scripts/verification/check-operational-sources.py',
    'scripts/verification/checks.test.mjs', 'scripts/verification/repository-layout.json',
}
CI_NEW_PATHS = {'scripts/verification/ci-selection.mjs', 'scripts/verification/ci-optimization.test.mjs'}
CI_MERGED_PREDECESSORS = {'scripts/verification/check-operational-sources.py': '75389cf4d7b6047ffa107cea3ef83620e2c9e15dbcac81b09545263f9c99c608', 'scripts/verification/checks.test.mjs': 'b18f228e48fafec474638de15722dee2257bf33a344bc2aed2beee33bfa70ad3'}


@lru_cache(maxsize=1)
def ci_receipt():
    path = ROOT / 'artifacts/repository-audits/proj-164-ci-ownership.json'
    assert path.is_file() and not path.is_symlink(), 'Missing PROJ-164 CI receipt'
    receipt = json.loads(path.read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-164'
    assert receipt['baseSha'] == '36277f1094a6514709b2bf5eb6c9737c9361a213'
    changes = receipt['changes']
    assert len(changes) == len(CI_PATHS) and {item['previousCandidatePath'] for item in changes} == CI_PATHS, 'Out-of-scope PROJ-164 CI owner'
    for item in changes:
        assert item['candidatePath'] == item['previousCandidatePath'], 'PROJ-164 owner cannot move'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-164 mode mismatch'
        for key in ['previousSha256', 'candidateSha256']:
            assert len(item[key]) == 64 and all(c in '0123456789abcdef' for c in item[key]), 'Invalid PROJ-164 hash'
        if item['candidatePath'] in MERGED_VERIFICATION_PREDECESSORS:
            assert item['previousSha256'] == CI_MERGED_PREDECESSORS[item['candidatePath']], 'PROJ-164 historical predecessor pin changed'
            assert item['candidateSha256'] == MERGED_VERIFICATION_PREDECESSORS[item['candidatePath']][1], 'PROJ-164 historical merge pin changed'
        source, digest, _ = merged_verification_file(ROOT / item['candidatePath'], item['candidateSha256'], item['candidateMode'])
        assert source.is_file() and not source.is_symlink(), 'PROJ-164 source missing: ' + item['candidatePath']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, 'PROJ-164 current hash mismatch: ' + item['candidatePath']
        assert not source.stat().st_mode & 0o111, 'PROJ-164 current mode mismatch'
    sources = receipt['newFiles']
    assert len(sources) == len(CI_NEW_PATHS) and {item['path'] for item in sources} == CI_NEW_PATHS, 'Out-of-scope PROJ-164 source'
    for item in sources:
        source = ROOT / item['path']
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == item['sha256'], 'PROJ-164 source hash mismatch: ' + item['path']
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-164 source mode mismatch'
    return receipt


def ci_file(path, expected_hash, expected_mode):
    candidate = str(path.relative_to(ROOT))
    change = next((item for item in ci_receipt()['changes'] if item['previousCandidatePath'] == candidate), None)
    if candidate in MERGED_VERIFICATION_PREDECESSORS:
        return merged_verification_file(path, expected_hash, expected_mode)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-164 predecessor pin mismatch: ' + candidate
        return sber_profile_file(path, change['candidateSha256'], change['candidateMode'])
    return sber_profile_file(path, expected_hash, expected_mode)


PERSON_MEMBERSHIPS_PREDECESSORS = {'apps/api/README.md': ('f785acd9d7fe41382bd4e768de3d689d8b9cf273ee9955c4e3123cb8411e9bd2', '100644'), 'apps/api/src/app.ts': ('df88c043361aad5ecfbf3f6dffe362ce5594b88117209be434a20d5db35f1304', '100644'), 'apps/api/src/consolidate-auth.ts': ('40e8aefada5ddce2009f5448b9e9c01069ad5a47b22f8367ef045d312ebacb9d', '100644'), 'apps/api/src/iam/auth-store.ts': ('7e1c8cc45c049318b1704f2fb7e47813862bcaeb3a5eba2bf8056ecab2a0bee5', '100644'), 'apps/api/src/iam/sber-client.ts': ('249ff6fb8aa4ddccc7c1e53bb9560710dcd074aca0c540871bf167408077b1e5', '100644'), 'apps/api/src/migrate.ts': ('4c487e02489eb76a2bab63fc16439ff5a21847b7d908024d597048bc29712b39', '100644'), 'apps/api/test/auth.test.ts': ('424f6a579df3df4383de00127a2e808bd47b8379121d24d6d775a59ba239a54d', '100644'), 'apps/api/test/consolidation.test.ts': ('6c616fd510d7330fb83dfd36cdb0c18024c29869810b7239fdc4e0505eb28d24', '100644'), 'apps/web/src/audience/intent.test.ts': ('cfeb6847b5847527859d36547d63dfaad9fd4c5e1bb3d39b404dad979aa73234', '100644'), 'apps/web/src/audience/intent.ts': ('a7fb3118f22e95fc15ad73dc0bd1a8a5bb6275846338725c71d00ae46f8e3db9', '100644'), 'deployment/forum-api/grant-runtime.sql': ('2c27de747e5e853d6d86883a816a4dbd395076befe148ef15e395318e21a0667', '100644'), 'deployment/forum-db/README.md': ('dc7a6729b70091237d0a09bad231c99d8a43a562249589e9e2379d081deb0281', '100644'), 'deployment/forum-db/apply-public.psql': ('55459ee9277042b63e0281ee15ed9a1f864cef6832d39b676fc7dc05e109a1a8', '100644'), 'deployment/forum-db/tests/profiles.sql': ('a950bdec1a0e4c88025315eb178c422e88d641060fb5fd0dde02d2590ed6dd04', '100644'), 'deployment/forum-db/tests/public-schema.sql': ('a0d17def597548cbad2c0eb34f7a54d81982e0763cdf85e9637a9adcdc2c67df', '100644'), 'deployment/forum-db/tests/test_configure_role_contract.py': ('d53d633f1be92590341fd1e28b41f8fd3849fd943105314c99b5dd8bd484bb37', '100644'), 'scripts/deployment/forum-db/configure_forum_app_role.sh': ('43ded821bb9d2bb6e47aa7ac0122aedf26809790ed5abc8f4b7aed2869e5ea90', '100755'), 'scripts/verification/check-api.sh': ('44255908ab14debdc66ca2ba836b6e226ad6c33b743bace384be4e42334c9a0f', '100644'), 'scripts/verification/check-operational-sources.py': ('e6531371791c4e6c8dd5170ef7eaec6248b1123349bc016be214f6a21c79323a', '100644'), 'scripts/verification/checks.test.mjs': ('d97ad3c36ee78bc36d3774523177efc064618807febd6d23c680f03862cadfd8', '100644')}
PERSON_MEMBERSHIPS_NEW_PATHS = {'apps/api/migrations/006_person_memberships.sql', 'apps/api/test/person-memberships.test.ts', 'docs/plans/2026-10-09-PROJ-161-person-memberships.md', 'apps/api/src/iam/person-profile.ts', 'apps/api/src/party/business-access.ts'}


@lru_cache(maxsize=1)
def person_memberships_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-161-person-memberships-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-161'
    assert receipt['baseSha'] == 'e6a910c4aa7f5795a1c178a47c64a1dc5aea9875', 'PROJ-161 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(PERSON_MEMBERSHIPS_PREDECESSORS) and {x['previousCandidatePath'] for x in changes} == set(PERSON_MEMBERSHIPS_PREDECESSORS), 'Out-of-scope PROJ-161 owner'
    for item in changes:
        path = item['previousCandidatePath']
        digest, mode = PERSON_MEMBERSHIPS_PREDECESSORS[path]
        assert item['candidatePath'] == path and item['previousSha256'] == digest, 'PROJ-161 predecessor mismatch'
        assert item['previousMode'] == item['candidateMode'] == mode, 'PROJ-161 mode mismatch'
        source, current_digest, current_mode = cabinet_settings_file(ROOT / path, item['candidateSha256'], item['candidateMode'])
        assert source.is_file() and not source.is_symlink(), path
        assert hashlib.sha256(source.read_bytes()).hexdigest() == current_digest, 'PROJ-161 current hash mismatch: ' + path
        assert bool(source.stat().st_mode & 0o111) == (current_mode == '100755'), 'PROJ-161 current mode mismatch: ' + path
    sources = receipt['newFiles']
    assert len(sources) == len(PERSON_MEMBERSHIPS_NEW_PATHS) and {x['path'] for x in sources} == PERSON_MEMBERSHIPS_NEW_PATHS, 'Out-of-scope PROJ-161 source'
    for item in sources:
        source, digest, _ = sber_profile_file(ROOT / item['path'], item['sha256'], item['mode'])
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, 'PROJ-161 source hash mismatch: ' + item['path']
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-161 source mode mismatch'
    return receipt


def person_memberships_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((x for x in person_memberships_receipt()['changes'] if x['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-161 chain mismatch: ' + candidate
        return cabinet_settings_file(ROOT / candidate, change['candidateSha256'], change['candidateMode'])
    return cabinet_settings_file(ROOT / candidate, expected_hash, expected_mode)


# PROJ-154 changes verification governance only. The old Task5/6/7 receipts
# stay immutable; this exact-path layer pins the resolved current predecessor.
GOVERNANCE_PATHS = {
    'package.json', '.github/workflows/quality.yml',
    'scripts/verification/repository-layout.json',
    'scripts/verification/check-operational-sources.py',
    'scripts/verification/checks.test.mjs',
}
PRIMER_SOURCE_PATHS = {
    'scripts/verification/check-primer-ui.py',
    'scripts/verification/primer-ui/policy.json',
    'scripts/verification/primer-ui/validate_primer_ui.py',
    'tests/integration/test_primer_ui_policy.py',
}
HISTORICAL_RECEIPTS = {
    'artifacts/repository-audits/accepted-source-matrix.json',
    'artifacts/repository-audits/task-5-source-parity.json',
    'artifacts/repository-audits/task-6-source-ownership.json',
    'artifacts/repository-audits/task-7-source-ownership.json',
}



# PROJ-160 adds only authenticated profile presentation and its serving boundary.
CABINET_PROFILE_PREDECESSORS = {'apps/api/README.md': 'c32210389388fb6de09242473e9aed20cd2ba2fb37dc52075283557fc822d0ee', 'apps/api/src/iam/auth-store.ts': '1e6c5d12a4725694b660a643d4455a8a0a2dfa88034e3b2d5c7e704c932e3d5b', 'apps/api/src/iam/auth.controller.ts': '90f5f5d31faa4fd5deab671fff092070d5a62ca0095014d480e65899dc97410b', 'apps/api/src/iam/sber-client.ts': 'b7079506bb6354585d6133ca904037b0314e3fe2071ffe33f737b58a2e2ad57a', 'apps/api/test/auth.test.ts': '5db68460957a3563aa891073a4f3ee629761ffae7e437e9ac4ab40e1b736e882', 'apps/dev-gateway/forum_dev_auth.py': '15c6a478909d7d3bc51ef365ca021f006ed611ce41614a331f7adf6c283889ae', 'apps/legacy-landing/tests/test_auth_gateway.py': 'ed4d0fc32196a60fb7f055479bb12a2bdd3c40968e222f63a729adab94698883', 'apps/profile-preview/src/ProfilePage.tsx': '6ff286610858bdd8154acc71d4382411ccf4bff6e4560bb4a286b043dfcbe180', 'apps/profile-preview/src/profile.ts': '2d6c70032bdb742414776af911d54bf28ddcb0f6c58cf242a0ce7da29f143464', 'apps/web/src/home/App.tsx': '53238ebe3046b1b7a96d9fdc15ed297837b5a569e49cee737a010974694e6b11', 'apps/web/src/home/Cabinet.tsx': '05d520198295ea43ae233e842047b03aa9a8c7515de6f302fb6618a0d2ae23c3', 'apps/web/src/home/home.test.tsx': '5eed055258c9fc1eeaf14a68283072148f7a18366b7f1e11d8d757960f0c22fd', 'deployment/release-manifest.schema.json': '30ec51003705b6d9bc3161d608f10d689ba1768f9d83aeb762a27c4c9ef0a421', 'deployment/release.md': '1cecca20132ecd0544d87f63456771e6a904af37c3006bfec965ef1b03a7ddbc', 'scripts/deployment/build-web-release.mjs': '383650dba4ca7ce5bd1732ed9f33c7793848abb5f045acd987353a9cf4fb2c6e', 'scripts/deployment/web_release.py': '53f0cb8abd529c923dec711da740d4a740676b03e22b6fc2334da0739aaa7e2a', 'scripts/verification/check-operational-sources.py': 'bd60178ec8a7b5285cfffeed28e5a0f55a8bed5a59e1169b79fd0be727425844', 'scripts/verification/checks.test.mjs': '2eb2eae93ecfb4fbaf7eb9987a71393e28821fca1276601776de0ed7fde2295d', 'scripts/verification/web-build-inputs.test.mjs': '23d7097d46e873f97910eef12ec4ed5a31f3f086e2f21caef51bf1dd177b3765', 'tests/e2e/public-site.spec.ts': 'efacc49ef7977a614115b0c2085cff9158873c734490e6d73eb73ae36a517d19', 'tests/integration/test_primer_ui_policy.py': '0fda95b2f163b459c42223cf5a3e06ed46958d70561f22dfcb2288b5d5c4b54f', 'tests/integration/test_web_release.py': 'bcec665377eb323cb4052f98292307601aa362239c92260c79d0b65762524f90'}
CABINET_PROFILE_NEW_PATHS = {'apps/web/src/home/cabinet.css', 'apps/web/src/home/Cabinet.test.tsx', 'docs/plans/2026-10-09-gitnexus-plan-cabinet-profile-integration.md'}

# Receipts and source remain fixed during this offline checker invocation.
@lru_cache(maxsize=1)
def cabinet_profile_receipt():
    receipt = json.loads((ROOT / 'artifacts/repository-audits/proj-160-cabinet-profile-ownership.json').read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-160'
    assert receipt['baseSha'] == '19ee01ed586f54e00a080844639864bc45278bde', 'PROJ-160 baseline mismatch'
    changes = receipt['changes']
    assert len(changes) == len(CABINET_PROFILE_PREDECESSORS) and {x['previousCandidatePath'] for x in changes} == set(CABINET_PROFILE_PREDECESSORS), 'Out-of-scope PROJ-160 owner'
    for item in changes:
        path = item['previousCandidatePath']
        assert item['candidatePath'] == path and item['previousSha256'] == CABINET_PROFILE_PREDECESSORS[path], 'PROJ-160 predecessor mismatch'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-160 mode mismatch'
        assert len(item['candidateSha256']) == 64 and all(c in '0123456789abcdef' for c in item['candidateSha256']), 'Invalid PROJ-160 hash'
    sources = receipt['newFiles']
    assert len(sources) == len(CABINET_PROFILE_NEW_PATHS) and {x['path'] for x in sources} == CABINET_PROFILE_NEW_PATHS, 'Out-of-scope PROJ-160 source'
    for item in sources:
        source = ROOT / item['path']
        assert source.is_file() and not source.is_symlink(), item['path']
        source, digest, _ = cabinet_settings_file(source, item['sha256'], item['mode'])
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, 'PROJ-160 source hash mismatch'
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-160 source mode mismatch'
    return receipt


def cabinet_profile_file(path, expected_hash, expected_mode):
    candidate = str(Path(path).relative_to(ROOT)) if Path(path).is_absolute() else str(path)
    change = next((x for x in cabinet_profile_receipt()['changes'] if x['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-160 chain mismatch: ' + candidate
        return person_memberships_file(ROOT / candidate, change['candidateSha256'], change['candidateMode'])
    return person_memberships_file(ROOT / candidate, expected_hash, expected_mode)


# PROJ-154 changes verification governance only. The old Task5/6/7 receipts
# stay immutable; this exact-path layer pins the resolved current predecessor.
GOVERNANCE_PATHS = {
    'package.json', '.github/workflows/quality.yml',
    'scripts/verification/repository-layout.json',
    'scripts/verification/check-operational-sources.py',
    'scripts/verification/checks.test.mjs',
}
PRIMER_SOURCE_PATHS = {
    'scripts/verification/check-primer-ui.py',
    'scripts/verification/primer-ui/policy.json',
    'scripts/verification/primer-ui/validate_primer_ui.py',
    'tests/integration/test_primer_ui_policy.py',
}
HISTORICAL_RECEIPTS = {
    'artifacts/repository-audits/accepted-source-matrix.json',
    'artifacts/repository-audits/task-5-source-parity.json',
    'artifacts/repository-audits/task-6-source-ownership.json',
    'artifacts/repository-audits/task-7-source-ownership.json',
}


@lru_cache(maxsize=2)
def governance_receipt(verify_history=False):
    path = ROOT / 'artifacts/repository-audits/proj-154-verification-ownership.json'
    assert path.is_file() and not path.is_symlink(), 'Missing PROJ-154 governance receipt'
    receipt = json.loads(path.read_text())
    assert receipt['schemaVersion'] == 1 and receipt['taskCode'] == 'PROJ-154'
    assert receipt['baseSha'] == 'f53901d129d78b1df1f0d89e5b7462734856d781'
    changes = receipt['changes']
    assert len(changes) == len(GOVERNANCE_PATHS), 'Duplicate or missing PROJ-154 governance owner'
    assert {item['previousCandidatePath'] for item in changes} == GOVERNANCE_PATHS, 'Out-of-scope PROJ-154 governance owner'
    for item in changes:
        assert item['candidatePath'] == item['previousCandidatePath'], 'PROJ-154 governance owner cannot move'
        assert item['previousMode'] == item['candidateMode'] == '100644', 'PROJ-154 governance mode must stay unchanged'
        for key in ('previousSha256', 'candidateSha256'):
            assert len(item[key]) == 64 and all(c in '0123456789abcdef' for c in item[key]), 'Invalid PROJ-154 hash'
    sources = receipt['newFiles']
    assert len(sources) == len(PRIMER_SOURCE_PATHS) and {item['path'] for item in sources} == PRIMER_SOURCE_PATHS, 'Out-of-scope PROJ-154 source'
    historical = receipt['historicalReceipts']
    assert len(historical) == len(HISTORICAL_RECEIPTS) and {item['path'] for item in historical} == HISTORICAL_RECEIPTS, 'Invalid historical receipt scope'
    for item in sources + (historical if verify_history else []):
        source, digest, _ = sber_auth_file(ROOT / item['path'], item['sha256'], item['mode'])
        assert source.is_file() and not source.is_symlink(), item['path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, 'PROJ-154 receipt hash mismatch: ' + item['path']
        assert item['mode'] == '100644' and not source.stat().st_mode & 0o111, 'PROJ-154 source mode mismatch'
    return receipt


def governance_file(candidate, expected_hash, expected_mode):
    receipt = governance_receipt()
    change = next((item for item in receipt['changes'] if item['previousCandidatePath'] == candidate), None)
    if change:
        assert change['previousSha256'] == expected_hash and change['previousMode'] == expected_mode, 'PROJ-154 baseline pin mismatch: ' + candidate
        return ROOT / candidate, change['candidateSha256'], change['candidateMode']
    return ROOT / candidate, expected_hash, expected_mode


def verify_current(candidate, expected_hash, expected_mode):
    path, digest, mode = current_file(candidate, expected_hash, expected_mode)
    assert path.is_file() and not path.is_symlink(), candidate
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, str(path)
    assert ('100755' if path.stat().st_mode & 0o111 else '100644') == mode, str(path)
    return path


def verify_provenance():
    # Validate each ownership layer once per invocation, including source bytes.
    # A new invocation must observe changed receipts/files and a changed ROOT.
    for receipt in (task7_receipt, public_entry_receipt, sber_auth_receipt, main_auth_receipt,
                    login_entry_receipt, provider_button_receipt, skip_link_receipt,
                    logout_home_receipt, cabinet_profile_receipt,
                    person_memberships_receipt, cabinet_settings_receipt,
                    governance_receipt, ci_receipt, merged_verification_receipt, sber_profile_receipt):
        receipt.cache_clear()
    matrix = json.loads((ROOT / 'artifacts/repository-audits/accepted-source-matrix.json').read_text())
    assert matrix['schemaVersion'] == 1
    accepted = 0
    for component in matrix['components']:
        assert len(component['sourceSha']) == 40
        for file in component['files']:
            candidate = file.get('candidatePath')
            if not candidate:
                continue
            verify_current(candidate, file['candidateSha256'], file['candidateMode'])
            # Historical Git blob remains a pin of the originally accepted bytes;
            # current changed content is independently SHA-verified by Task7.
            path, digest, _ = current_file(candidate, file['candidateSha256'], file['candidateMode'])
            if digest == file['candidateSha256']:
                data = path.read_bytes()
                blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
                assert blob == file['candidateGitBlob'], candidate
            accepted += 1
    assert accepted > 0
    parity_path = ROOT / 'artifacts/repository-audits/task-5-source-parity.json'
    parity = json.loads(parity_path.read_text())
    documentation = matrix.get('task6', {}).get('currentDocumentationOwnership', [])
    verification = matrix.get('task6', {}).get('currentVerificationOwnership', [])
    changes = {item['previousCandidatePath']: item for item in documentation + verification}
    assert len(changes) == len(documentation) + len(verification), 'Duplicate Task6 ownership override'
    known_documents = {file['newPath'] for file in parity['files'] if Path(file['newPath']).suffix == '.md'}
    policy_paths = {'scripts/verification/check-operational-sources.py', 'scripts/verification/check-repository-layout.mjs',
                    'scripts/verification/repository-layout.json', 'scripts/verification/checks.test.mjs'}
    for item in documentation:
        assert item['previousCandidatePath'] in known_documents, 'Unknown or runtime documentation parity override'
        candidate = Path(item['candidatePath'])
        assert not candidate.is_absolute() and '..' not in candidate.parts and candidate.suffix == '.md', 'Task6 current owner must be a safe Markdown path'
        assert item['candidateMode'] == '100644', 'Task6 documentation cannot acquire executable mode'
    for item in verification:
        assert item['previousCandidatePath'] in policy_paths, 'Unknown or runtime verification parity override'
        assert item['candidatePath'] == item['previousCandidatePath'], 'Task6 verification owner cannot move'
        assert item['candidateMode'] == item['previousMode'], 'Task6 verification mode must stay unchanged'
    if changes:
        assert hashlib.sha256(parity_path.read_bytes()).hexdigest() == matrix['task6']['task5SnapshotSha256'], 'Historical Task5 parity snapshot changed'
    ownership = json.loads((ROOT / 'artifacts/repository-audits/task-6-source-ownership.json').read_text())
    assert ownership['schemaVersion'] == 1
    assert hashlib.sha256((ROOT / 'artifacts/repository-audits/accepted-source-matrix.json').read_bytes()).hexdigest() == ownership['acceptedSourceMatrixSha256'], 'Current accepted matrix receipt changed'
    pins = [{**{key: component[key] for key in ['id', 'pullRequest', 'sourceSha', 'sourcePrefixes', 'taskCodes']},
             'files': [{key: file[key] for key in ['sourcePath', 'sourceMode', 'sourceGitBlob', 'sourceSha256']} for file in component['files']]}
            for component in matrix['components']]
    digest = hashlib.sha256(json.dumps(pins, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    assert digest == ownership['immutableSourcePinsSha256'], 'Immutable source pins changed'
    for file in parity['files']:
        if file['newPath'] == 'artifacts/repository-audits/accepted-source-matrix.json':
            assert file['newSha256'] == ownership['previousAcceptedSourceMatrixSha256'], 'Historical accepted matrix pin changed'
            assert file['newMode'] == ownership['mode'] == '100644'
            continue
        change = changes.get(file['newPath'])
        if change:
            assert change['previousSha256'] == file['newSha256'] and change['previousMode'] == file['newMode'], file['newPath']
            # The dated Task5 snapshot stays immutable; verify current ownership separately.
            verify_current(change['candidatePath'], change['candidateSha256'], change['candidateMode'])
        else:
            verify_current(file['newPath'], file['newSha256'], file['newMode'])
        if file['unchanged']:
            assert file['previousSha256'] == file['newSha256'] and file['previousMode'] == file['newMode']
    receipt_path = ROOT / 'artifacts/repository-audits/task-7-source-ownership.json'
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text())
        for item in receipt['changes']:
            verify_current(item['previousCandidatePath'], item['previousSha256'], item['previousMode'])
        for item in receipt['newFiles']:
            path, digest, _ = public_entry_file(ROOT / item['path'], item['sha256'], '100644')
            assert path.is_file() and not path.is_symlink(), item['path']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, item['path']
    governance = governance_receipt(verify_history=True)
    for item in governance['changes']:
        path, digest, _ = public_entry_file(ROOT / item['candidatePath'], item['candidateSha256'], item['candidateMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-154 current hash mismatch: ' + item['candidatePath']
        assert not path.stat().st_mode & 0o111, 'PROJ-154 current mode mismatch'
    for item in public_entry_receipt()['changes']:
        path, digest, _ = sber_auth_file(ROOT / item['candidatePath'], item['candidateSha256'], item['candidateMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-31 current hash mismatch: ' + item['candidatePath']
        assert not path.stat().st_mode & 0o111, 'PROJ-31 current mode mismatch'
    for item in sber_auth_receipt()['changes']:
        path, digest, _ = main_auth_file(ROOT / item['candidatePath'], item['candidateSha256'], item['candidateMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-155 successor hash mismatch'
        assert not path.stat().st_mode & 0o111, 'PROJ-155 successor mode mismatch'
    for item in main_auth_receipt()['changes']:
        path, digest, _ = login_entry_file(ROOT / item['candidatePath'], item['candidateSha256'], item['candidateMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-156 successor hash mismatch'
        assert not path.stat().st_mode & 0o111, 'PROJ-156 successor mode mismatch'
    for item in login_entry_receipt()['changes']:
        path, digest, _ = provider_button_file(ROOT / item['candidatePath'], item['candidateSha256'], item['candidateMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-157 successor hash mismatch'
        assert not path.stat().st_mode & 0o111, 'PROJ-157 current mode mismatch'
    for item in provider_button_receipt()['changes']:
        path, digest, _ = skip_link_file(ROOT / item['candidatePath'], item['candidateSha256'], item['candidateMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-158 successor hash mismatch'
        assert not path.stat().st_mode & 0o111, 'PROJ-158 successor mode mismatch'
    for item in skip_link_receipt()['changes']:
        path, digest, _ = logout_home_file(ROOT / item['candidatePath'], item['candidateSha256'], item['candidateMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-159 successor hash mismatch'
        assert not path.stat().st_mode & 0o111, 'PROJ-159 successor mode mismatch'
    for item in logout_home_receipt()['changes']:
        path, digest, _ = cabinet_profile_file(ROOT / item['candidatePath'], item['candidateSha256'], item['candidateMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-38 successor hash mismatch'
        assert not path.stat().st_mode & 0o111, 'PROJ-38 successor mode mismatch'
    for item in cabinet_profile_receipt()['changes']:
        path, digest, mode = person_memberships_file(ROOT / item['candidatePath'],item['candidateSha256'],item['candidateMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-160 successor hash mismatch: ' + item['candidatePath']
        assert mode == '100644' and not path.stat().st_mode & 0o111, 'PROJ-160 successor mode mismatch'
    person_memberships_receipt()
    for item in cabinet_settings_receipt()['changes']:
        path, digest, mode = cabinet_settings_file(ROOT / item['previousCandidatePath'], item['previousSha256'], item['previousMode'])
        assert path.is_file() and not path.is_symlink(), item['candidatePath']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'PROJ-163 current hash mismatch: ' + item['candidatePath']
        assert mode == '100644' and not path.stat().st_mode & 0o111, 'PROJ-163 current mode mismatch'
    ci_receipt()
    merged_verification_receipt()
    sber_profile_receipt()
    return accepted


class Template(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = set()

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag)


def main():
    count = verify_provenance()
    run("python3", str(ROOT / "scripts/verification/check-mail-resources.py"))
    owners = ['deployment/mail', 'deployment/openproject', 'deployment/pgadmin', 'deployment/vps/outline']
    tool_owners = ['scripts/deployment/forum-db', 'scripts/deployment/pgadmin', 'scripts/deployment/mail',
                   'scripts/verification/mail', 'scripts/maintenance/mail', 'scripts/maintenance/openproject']
    for owner in owners + tool_owners:
        for path in (ROOT / owner).rglob('*'):
            if path.suffix == '.py':
                ast.parse(path.read_text(), filename=str(path))
            elif path.suffix == '.sh':
                run('bash', '-n', str(path))
            elif path.suffix == '.rb':
                run('docker', 'run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'ruby', '-v', f'{path}:/candidate.rb:ro', RUBY, '-c', '/candidate.rb')
    # Resolve administrative source contracts without importing or running any
    # administrator (install-caddy-routes has deliberate top-level side effects).
    mail = ROOT / 'scripts/deployment/mail'
    helper = ast.parse((mail / 'stalwart_api.py').read_text())
    exported = {node.name for node in helper.body if isinstance(node, ast.FunctionDef)}
    exported |= {target.id for node in helper.body if isinstance(node, ast.Assign)
                 for target in node.targets if isinstance(target, ast.Name)}
    for name in ['configure_acme.py', 'deploy-certificate.py']:
        imports = [node for node in ast.walk(ast.parse((mail / name).read_text()))
                   if isinstance(node, ast.ImportFrom) and node.module == 'stalwart_api']
        assert len(imports) == 1 and imports[0].level == 0, name
        assert {alias.name for alias in imports[0].names} <= exported, name
    pgadmin = ast.parse((ROOT / 'scripts/deployment/pgadmin/configure-admin.py').read_text())
    source = next(node.value for node in pgadmin.body if isinstance(node, ast.Assign)
                  and any(isinstance(target, ast.Name) and target.id == 'SOURCE' for target in node.targets))
    expected = ast.parse("Path(__file__).resolve().parents[3] / 'deployment' / 'pgadmin'", mode='eval').body
    assert ast.dump(source) == ast.dump(expected), 'pgAdmin configuration owner'
    for name in ['servers.json', 'compose.yaml']:
        assert (ROOT / 'deployment/pgadmin' / name).is_file(), name
    run('node', '--check', str(ROOT / 'scripts/verification/forum-api/test-callback-relay.mjs'))
    templates = sorted((ROOT / 'deployment/mail/templates').rglob('*.html'))
    assert len(templates) == 8
    for path in templates:
        parser = Template()
        parser.feed(path.read_text())
        assert {'html', 'head', 'body'} <= parser.tags, str(path)
        if path.name == 'index.html':
            assert 'iframe' in parser.tags and 'src="email.html"' in path.read_text()
        else:
            assert 'table' in parser.tags, str(path)

    # Copy source only into a disposable directory. Missing runtime env files
    # get synthetic empty fixtures; no live secret/env file is read or generated.
    with tempfile.TemporaryDirectory(prefix='forum-operational-check-') as directory:
        temp = Path(directory)
        for owner in owners + ['deployment/forum-api']:
            target = temp / owner
            target.mkdir(parents=True)
            for path in (ROOT / owner).glob('*'):
                if path.is_file() and path.suffix in ('.yaml', '.example'):
                    shutil.copyfile(path, target / path.name)
            (target / '.env').write_text('POSTGRES_PASSWORD=synthetic-check-only\nOPENPROJECT_SMTP__PASSWORD=synthetic-check-only\nCOLLABORATIVE_SERVER_SECRET=synthetic-check-only\n')
            (target / 'docker.env').write_text('')
            run('docker', 'compose', '--env-file', str(target / '.env'), '-f', str(target / 'compose.yaml'), 'config', '--quiet')
        api = temp / 'deployment/forum-api'
        config = json.loads(run('docker', 'compose', '--env-file', str(api / '.env'), '-f', str(api / 'compose.yaml'), '-f', str(api / 'sber-dns.override.yaml'), 'config', '--format', 'json'))
        assert config['services']['forum_api']['dns'] == ['172.16.160.1']
        outline = temp / 'deployment/vps/outline'
        config = json.loads(run('docker', 'compose', '--env-file', str(outline / '.env'), '-f', str(outline / 'compose.yaml'), '-f', str(outline / 'dev-landing-api.override.yaml'), 'config', '--format', 'json'))
        assert config['services']['dev_landing_auth']['environment']['FORUM_API_ORIGIN'] == 'http://forum_api:3001'
        pg = temp / 'deployment/pgadmin'
        config = json.loads(run('docker', 'compose', '-f', str(pg / 'compose.yaml'), 'config', '--format', 'json'))
        assert config['services']['pgadmin']['ports'][0]['host_ip'] == '127.0.0.1'
        assert config['services']['pgadmin']['environment']['PGADMIN_REPLACE_SERVERS_ON_STARTUP'] == 'False'
    # Adapt in a disposable network-none container. It neither starts Caddy
    # nor loads certificate secrets, active adapted configs or server services.
    source = ROOT / 'deployment/vps/outline/Caddyfile.example'
    adapted = json.loads(run('docker', 'run', '--rm', '--network', 'none', '--read-only', '-v', f'{source}:/candidate/Caddyfile:ro', CADDY, 'caddy', 'adapt', '--config', '/candidate/Caddyfile', '--adapter', 'caddyfile'))
    assert adapted['apps']['http']['servers']
    print(f'Operational sources: {count} provenance entries, 4 Compose owners, 2 overrides, Caddy adaptation, 8 HTML templates, administrative resource/import closure and Python/shell/Ruby/Node syntax passed')


if __name__ == '__main__':
    main()
