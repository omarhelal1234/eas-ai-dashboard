"""
Orchestrator — the top-level runner.

Usage:
    python -m src.orchestrator --cr "Add CSV export for leaderboard" \
        --intent "SPOCs need to download the practice leaderboard as CSV"

Flow:
    Business → BA → SA → Dev Lead → Quality → Testing → Supervisor consolidate.

At every stage gate the Supervisor validates the artefact. On REJECT the loop
re-runs the responsible agent up to MAX_RETRIES times. After that it parks the
CR in BLOCKED and writes the run log.

The orchestrator is async because the Claude Agent SDK is async.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from typing import Awaitable, Callable

from .config import REPO_ROOT
from .shared_state import CRWorkspace, Stage, make_cr_id
from .agents import (
    BusinessAgent,
    BAAgent,
    SAAgent,
    DevLeadAgent,
    QualityAgent,
    TestingAgent,
    SupervisorAgent,
)
from .agents.base_agent import AgentResult

MAX_RETRIES = 2  # per stage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_VERDICT_RE = re.compile(r"\{.*?\"verdict\".*?\}", re.S)


def parse_verdict(text: str) -> dict:
    """Pull the last JSON blob with a 'verdict' key out of supervisor output."""
    matches = list(_VERDICT_RE.finditer(text or ""))
    if not matches:
        return {"verdict": "REJECT", "reason": "No verdict returned", "next_action": ""}
    try:
        return json.loads(matches[-1].group(0))
    except json.JSONDecodeError:
        return {"verdict": "REJECT", "reason": "Malformed verdict JSON", "next_action": ""}


# ---------------------------------------------------------------------------
# Stage runner
# ---------------------------------------------------------------------------
async def run_stage(
    *,
    label: str,
    stage: Stage,
    cr: CRWorkspace,
    runner: Callable[[], Awaitable[AgentResult]],
    supervisor: SupervisorAgent,
    artefact_filename: str,
) -> bool:
    """Run an agent, then have the supervisor validate its artefact."""
    print(f"\n━━━ {label} ━━━")
    cr.transition(stage, by="orchestrator", reason=f"entering {stage.value}")

    for attempt in range(1, MAX_RETRIES + 2):
        result = await runner()
        print(f"  · {label} attempt {attempt}: {'ok' if result.ok else 'crashed'}")
        if not result.ok:
            continue

        cr.record(agent=result.agent, filename=artefact_filename, note=f"attempt {attempt}")
        artefact_path = str(cr.folder / artefact_filename)

        validation = await supervisor.run(
            supervisor.validate_task(cr=cr, artefact_path=artefact_path, stage=stage.value)
        )
        verdict = parse_verdict(validation.summary)
        print(f"  · Supervisor verdict: {verdict['verdict']} — {verdict.get('reason', '')}")

        if verdict["verdict"] == "APPROVE":
            return True

    cr.transition(Stage.BLOCKED, by="supervisor_agent", reason=f"{label} exceeded retries")
    return False


# ---------------------------------------------------------------------------
# End-to-end pipeline
# ---------------------------------------------------------------------------
async def run_pipeline(title: str, intent: str) -> CRWorkspace:
    cwd = str(REPO_ROOT)
    cr = CRWorkspace(cr_id=make_cr_id(title), title=title)
    cr.ensure()
    print(f"Starting pipeline for {cr.cr_id}: {cr.title}\nWorkspace: {cr.folder}")

    business = BusinessAgent(cwd=cwd)
    ba = BAAgent(cwd=cwd)
    sa = SAAgent(cwd=cwd)
    dev = DevLeadAgent(cwd=cwd)
    quality = QualityAgent(cwd=cwd)
    testing = TestingAgent(cwd=cwd)
    supervisor = SupervisorAgent(cwd=cwd)

    stages = [
        ("Business", Stage.DRAFT_BRD, lambda: business.run(business.build_task(cr=cr, intent=intent)), "BRD-draft.md"),
        ("BA", Stage.SOW, lambda: ba.run(ba.build_task(cr=cr)), "SOW.md"),
        ("SA", Stage.HLD, lambda: sa.run(sa.build_task(cr=cr)), "HLD.md"),
        ("Dev Lead", Stage.DEV, lambda: dev.run(dev.build_task(cr=cr)), "PATCH.md"),
        ("Quality", Stage.QA, lambda: quality.run(quality.build_task(cr=cr)), "QA-Report.md"),
        ("Testing", Stage.TEST, lambda: testing.run(testing.build_task(cr=cr)), "TestPlan.md"),
    ]

    for label, stage, runner, artefact in stages:
        ok = await run_stage(
            label=label,
            stage=stage,
            cr=cr,
            runner=runner,
            supervisor=supervisor,
            artefact_filename=artefact,
        )
        if not ok:
            print(f"\n✗ Pipeline BLOCKED at {label}. See {cr.folder}/RUN-LOG.md")
            cr.dump_run_log()
            return cr

    # Consolidation
    print("\n━━━ Consolidation ━━━")
    cr.transition(Stage.DONE, by="supervisor_agent", reason="all stages approved")
    await supervisor.run(supervisor.consolidate_task(cr=cr))
    cr.dump_run_log()
    print(f"\n✓ Pipeline complete. Run log: {cr.folder}/RUN-LOG.md")
    return cr


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description="E-AI-S Multi-Agent System orchestrator")
    parser.add_argument("--cr", required=True, help="Short CR title")
    parser.add_argument("--intent", required=True, help="Stakeholder intent / problem statement")
    args = parser.parse_args()

    try:
        cr = asyncio.run(run_pipeline(args.cr, args.intent))
    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 130

    return 0 if cr.stage == Stage.DONE else 1


if __name__ == "__main__":
    sys.exit(main())
