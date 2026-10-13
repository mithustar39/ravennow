"""Test configuration.

Sets a throwaway SQLite database and puts ``backend/`` on the import path so
tests can ``import app.*``.
"""

from __future__ import annotations

import os
import pathlib
import sys
import tempfile

TMP_DIR = pathlib.Path(tempfile.mkdtemp(prefix="ravennow-tests-"))
os.environ["RAVENNOW_DB"] = f"sqlite:///{(TMP_DIR / 'test.db').as_posix()}"
os.environ["RAVENNOW_ENV"] = "test"
os.environ["RAVENNOW_SECRET"] = "test-secret"

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))
