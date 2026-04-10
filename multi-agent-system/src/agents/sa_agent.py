"""SA Agent — challenges the ask and produces the HLD."""
from __future__ import annotations

from ..config import SA_AGENT
from ..shared_state import CRWorkspace
from .base_agent import BaseAgent


class SAAgent(BaseAgent):
    def __init__(self, cwd: str | None = None) -> None:
        super().__init__(SA_AGENT, cwd=cwd)

    def build_task(self, *, cr: CRWorkspace) -> str:
        return f"""Read the BRD and SOW in {cr.folder} as well as the existing
docs/HLD.md, docs/CODE_ARCHITECTURE.md, and sql/001_schema.sql.

Your job is to CHALLENGE before you design:
1. Is there already a capability in the dashboard that covers this request?
   If yes, the simplest path is configuration, not new code — say so.
2. Does this conflict with the Supabase RLS model or the role hierarchy
   (Admin / SPOC / Contributor)?
3. Does it exceed what GitHub Pages (static hosting) can support?

Then produce an HLD at {cr.folder}/HLD.md containing:
- Challenges section (your push-backs, if any)
- Data model changes (SQL delta against sql/001_schema.sql)
- API / RPC changes (function signatures, RLS impact)
- Frontend component changes (which files in js/ and css/)
- Security impact
- Rollout plan (feature flag? backfill? migration order?)
- Estimated complexity: LOW / MEDIUM / HIGH with justification

If your Challenges are severe, set stage to BLOCKED and escalate to the Supervisor."""
