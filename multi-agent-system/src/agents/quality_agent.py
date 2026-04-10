"""Quality Agent — verifies code quality, security, and structure."""
from __future__ import annotations

from ..config import QUALITY_AGENT
from ..shared_state import CRWorkspace
from .base_agent import BaseAgent


class QualityAgent(BaseAgent):
    def __init__(self, cwd: str | None = None) -> None:
        super().__init__(QUALITY_AGENT, cwd=cwd)

    def build_task(self, *, cr: CRWorkspace) -> str:
        return f"""Read {cr.folder}/PATCH.md and then review the actual files it touched.

Evaluate against this checklist and write findings to {cr.folder}/QA-Report.md:

**Code style**
- Consistent with existing js/*.js (naming, indentation, 2-space, JSDoc on public fns)
- No dead code, no commented-out blocks

**Security**
- No hardcoded secrets, keys, or Supabase service-role tokens
- RLS policies still prevent cross-practice data access
- No innerHTML string concatenation (XSS)
- User input is sanitised before Supabase writes

**Structure**
- Functions under ~50 lines, modules under ~1000
- No duplication of logic already in js/db.js or js/utils.js

**Accessibility**
- WCAG 2.1 AA preserved (focus states, aria labels, contrast)

**Performance**
- No N+1 Supabase calls in loops
- Charts not re-rendered inside render loops

For each finding use: `[SEVERITY] Location — Issue — Suggested fix`.
End with a **Verdict: PASS** or **Verdict: FAIL** line.

If FAIL, control returns to the Dev Lead Agent."""
