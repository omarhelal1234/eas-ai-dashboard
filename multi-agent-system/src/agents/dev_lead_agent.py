"""Dev Lead Agent — implements the change in the real repo."""
from __future__ import annotations

from ..config import DEV_LEAD_AGENT
from ..shared_state import CRWorkspace
from .base_agent import BaseAgent


class DevLeadAgent(BaseAgent):
    def __init__(self, cwd: str | None = None) -> None:
        super().__init__(DEV_LEAD_AGENT, cwd=cwd)

    def build_task(self, *, cr: CRWorkspace, qa_feedback: str | None = None) -> str:
        feedback_block = ""
        if qa_feedback:
            feedback_block = f"""

## Prior QA feedback to address
{qa_feedback}

Re-open the affected files and apply the fixes. Do not introduce new scope."""
        return f"""Read {cr.folder}/BRD-draft.md, {cr.folder}/SOW.md, {cr.folder}/HLD.md.

1. If the HLD is wrong or unimplementable, STOP and write a blocker to
   {cr.folder}/DEV-BLOCKER.md explaining why — do not guess.
2. Otherwise implement the change in the E-AI-S repo:
   - Frontend files live in js/, css/, and the *.html files at repo root.
   - Backend SQL lives in sql/001_schema.sql — add migrations as new files
     sql/NNN_*.sql, do not rewrite 001.
   - Follow the EAS_Auth / EAS_DB namespacing already in js/auth.js and js/db.js.
   - Never edit js/config.js or check in secrets.
3. Write a patch summary to {cr.folder}/PATCH.md listing every file touched,
   the reason, and the line ranges. Include a ready-to-paste PR description.{feedback_block}

Use Edit and Write tools. Run any quick sanity checks via Bash (e.g. `node -c`
or a syntax check) before finishing."""
