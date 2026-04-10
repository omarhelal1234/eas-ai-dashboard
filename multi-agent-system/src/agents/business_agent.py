"""Business Agent — drafts new BRDs and reports production issues."""
from __future__ import annotations

from ..config import BUSINESS_AGENT
from ..shared_state import CRWorkspace
from .base_agent import BaseAgent


class BusinessAgent(BaseAgent):
    def __init__(self, cwd: str | None = None) -> None:
        super().__init__(BUSINESS_AGENT, cwd=cwd)

    def build_task(self, *, cr: CRWorkspace, intent: str) -> str:
        return f"""New Change Request: **{cr.title}**
Intent from stakeholder: {intent}

Please:
1. Read the current docs/BRD.md to understand the existing scope and style.
2. Draft a BRD section for this CR following the same structure:
   - Executive Summary (2-3 sentences, business value first)
   - Objectives with KPIs
   - In-scope / out-of-scope bullets
   - Functional requirements (numbered FR-*)
   - Acceptance criteria (given/when/then)
3. Save it to {cr.folder}/BRD-draft.md

Do not propose any technical implementation — the SA will do that."""
