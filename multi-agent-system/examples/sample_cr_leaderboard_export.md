# Sample CR — Leaderboard CSV Export

**Command:**

```bash
python -m src.orchestrator \
  --cr "Leaderboard CSV export" \
  --intent "Practice SPOCs need to download their leaderboard as CSV every week to paste into their own status reports. Today they screenshot it."
```

**Expected artefacts** under `docs/cr/CR-YYYYMMDD-leaderboard-csv-export/`:

| File | Owner |
|------|-------|
| BRD-draft.md | Business Agent |
| SOW.md | BA Agent |
| HLD.md | SA Agent |
| PATCH.md | Dev Lead Agent |
| QA-Report.md | Quality Agent |
| TestPlan.md | Testing Agent |
| Bugs.md | Testing Agent (if any) |
| RUN-LOG.md | Supervisor Agent |

**Consolidated updates** (made by the Supervisor on DONE):

- `docs/BRD.md` — new entry in Change Log referencing CR-ID
- `docs/HLD.md` — no data-model delta, new frontend util `exportLeaderboardCSV` in js/utils.js
- `docs/IMPLEMENTATION_PLAN.md` — new milestone line
