"""Testing Agent — generates test cases and raises defects."""
from __future__ import annotations

from ..config import TESTING_AGENT
from ..shared_state import CRWorkspace
from .base_agent import BaseAgent


class TestingAgent(BaseAgent):
    def __init__(self, cwd: str | None = None) -> None:
        super().__init__(TESTING_AGENT, cwd=cwd)

    def build_task(self, *, cr: CRWorkspace) -> str:
        return f"""Derive test cases from the acceptance criteria in
{cr.folder}/BRD-draft.md and the patch in {cr.folder}/PATCH.md.

1. Write a test plan at {cr.folder}/TestPlan.md containing:
   - Positive cases for each FR-*
   - Negative cases (invalid input, missing auth, cross-role boundary)
   - Edge cases: quarter boundary, empty practice, user with no tasks,
     RLS isolation between practices
   - Role matrix coverage: Admin, SPOC, Contributor
   - Each case has: ID, Pre-conditions, Steps, Expected, Priority

2. Execute the cases. Steps can be manual (document precisely) or scripted
   where the tooling allows. File any defects you find in {cr.folder}/Bugs.md
   with:
   - BUG-ID
   - Severity (Critical / High / Medium / Low)
   - Repro steps
   - Expected vs actual
   - Suspected root cause
   - Assigned back to: dev_lead_agent

3. End the TestPlan with a **Testing Verdict: PASS** or **FAIL** line.

If FAIL, control returns to the Dev Lead Agent with the bug list."""
