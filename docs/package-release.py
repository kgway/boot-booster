"""Compatibility entry point. Candidate checks and packaging live in one Node script."""
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
raise SystemExit(subprocess.call(['node', str(root / 'docs/prepare-candidate.mjs')], cwd=root))
