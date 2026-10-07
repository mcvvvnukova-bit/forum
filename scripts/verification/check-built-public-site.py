"""Verify the unified immutable artifact through the Docker serving boundary.

Legacy three-publisher composition remains in test_public_site_release.py;
current built output uses the one apps/web owner and web_release publisher.
"""
from pathlib import Path
import subprocess
import sys
ROOT = Path(__file__).resolve().parents[2]
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 scripts/verification/check-built-public-site.py EXACT_ARTIFACT')
subprocess.run(['bash', str(ROOT / 'scripts/verification/check-web-release.sh'), sys.argv[1]], check=True)
