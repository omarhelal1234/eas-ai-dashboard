"""Supervisor Agent — validates, orchestrates, consolidates."""
from __future__ import annotations

from ..config import SUPERVISOR_AGENT
from ..shared_state import CRWorkspace
from .base_agent import BaseAgent


class SupervisorAgent(BaseAgent):
    def __init__(self, cwd: str | None = None) -> None:
        super().__init__(SUPERVISOR_AGENT, cwd=cwd)

    # ------------------------------------------------------------------
    # Validation prompts, one per stage gate
    # ------------------------------------------------------------------
    def validate_task(self, *, cr: CRWorkspace, artefact_path: str, stage: str) -> str:
        return f"""You are the Supervisor. A {stage} artefact was just written at
{artefact_path} for {cr.cr_id} ({cr.title}).

Review it hard. Answer in this exact JSON shape on the LAST line of your reply:

{{"verdict": "APPROVE" | "REJECT", "reason": "...", "next_action": "..."}}

Consider:
- Does it match the CR title and stakeholder intent?
- Is it specific, testable, implementable?
- Does it conflict with anything in docs/BRD.md, docs/HLD.md, CODE_ARCHITECTURE.md?
- For QA / Test stages — is the verdict line explicit and correct?

Only APPROVE when you genuinely would ship it. Otherwise REJECT and say exactly
what must change."""

    def consolidate_task(self, *, cr: CRWorkspace) -> str:
        return f"""CR {cr.cr_id} has passed all stages. Consolidate:

1. Read every artefact in {cr.folder}.
2. Append a new section to docs/BRD.md under "Change Log" referencing this CR.
3. Append a new section to docs/HLD.md with the data-model and API deltas.
4. Append a new milestone entry to docs/IMPLEMENTATION_PLAN.md.
5. Make sure every update in the canonical docs links back to {cr.folder}.
6. Do NOT reformat or reflow the existing doc content — append only."""
