"""
Smoke tests — exercise the bits that don't need the SDK or API key.

Run with: `python -m pytest tests/` from the multi-agent-system folder.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.config import ALL_AGENTS, REPO_ROOT  # noqa: E402
from src.shared_state import CRWorkspace, Stage, make_cr_id  # noqa: E402
from src.orchestrator import parse_verdict  # noqa: E402


def test_all_seven_agents_registered():
    assert set(ALL_AGENTS) == {
        "business_agent",
        "ba_agent",
        "sa_agent",
        "dev_lead_agent",
        "quality_agent",
        "testing_agent",
        "supervisor_agent",
    }


def test_repo_root_points_at_eas():
    assert (REPO_ROOT / "docs" / "BRD.md").exists()
    assert (REPO_ROOT / "js" / "db.js").exists()


def test_make_cr_id_is_slug_safe():
    cr_id = make_cr_id("Add CSV Export!!!")
    assert cr_id.startswith("CR-")
    assert " " not in cr_id and "!" not in cr_id


def test_workspace_records_and_transitions(tmp_path, monkeypatch):
    monkeypatch.setattr("src.shared_state.CR_WORKSPACE", tmp_path)
    cr = CRWorkspace(cr_id="CR-TEST", title="Test CR")
    cr.ensure()
    cr.record("business_agent", "BRD-draft.md", note="seed")
    cr.transition(Stage.SOW, by="orchestrator", reason="ready")
    assert cr.stage == Stage.SOW
    assert len(cr.artefacts) == 1
    log = cr.dump_run_log()
    assert log.exists() and "Test CR" in log.read_text()


def test_parse_verdict_handles_trailing_json():
    text = 'All good.\n{"verdict": "APPROVE", "reason": "looks fine", "next_action": "continue"}'
    v = parse_verdict(text)
    assert v["verdict"] == "APPROVE"


def test_parse_verdict_defaults_to_reject():
    v = parse_verdict("no json here")
    assert v["verdict"] == "REJECT"
