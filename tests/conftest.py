"""pytest integration for the check()-style test modules.

The original suites are standalone scripts (`python tests/test_engine.py`): each test
function calls check(name, condition), which appends to a module-level RESULTS list, and
main() prints and counts the failures. Under pytest that design passed silently - a test
function that recorded a failed check still returned normally, so `pytest -q` reported
every test green whatever the checks said.

This hook closes that gap without touching any test body: it notes how many results the
module had before each test runs and fails the test if any check recorded during it
failed, naming every failing check.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.hookimpl(wrapper=True)
def pytest_runtest_call(item):
    results = getattr(getattr(item, "module", None), "RESULTS", None)
    start = len(results) if isinstance(results, list) else None
    outcome = yield
    if start is not None:
        failed = [r for r in results[start:] if not r[0]]
        if failed:
            lines = "\n".join("  FAIL  %s   %s" % (name, str(detail)[:300])
                              for _, name, detail in failed[:25])
            more = "" if len(failed) <= 25 else "\n  ... and %d more" % (len(failed) - 25)
            pytest.fail("%d check(s) failed:\n%s%s" % (len(failed), lines, more),
                        pytrace=False)
    return outcome
