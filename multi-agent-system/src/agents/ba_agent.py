"""BA Agent — reviews the BRD and prepares the SOW."""
from __future__ import annotations

from ..config import BA_AGENT
from ..shared_state import CRWorkspace
from .base_agent import BaseAgent


class BAAgent(BaseAgent):
    def __init__(self, cwd: str | None = None) -> None:
        super().__init__(BA_AGENT, cwd=cwd)

    def build_task(self, *, cr: CRWorkspace) -> str:
        return f"""Review the draft BRD at {cr.folder}/BRD-draft.md.

1. Flag any ambiguous requirements — list them under "Clarifications Needed".
2. Identify implicit assumptions and document them.
3. Produce a Statement of Work at {cr.folder}/SOW.md with the following sections:
   - Scope summary
   - Deliverables (checkable list)
   - Effort estimate in person-days, broken down by component (frontend, SQL, docs, QA)
   - Dependencies (on other CRs, infra, Supabase features)
   - Risks with mitigation
   - Milestones with suggested dates
   - RACI table (Business, BA, SA, Dev Lead, QA, Testing, Supervisor)

Be pragmatic — this is a small team at Ejada EAS; do not over-engineer the SOW."""
