# E-AI-S Multi-Agent System (MAS)

> **Project:** EAS AI Adoption Dashboard (E-AI-S)
> **Module:** Multi-Agent Software Delivery System
> **Author:** Omar Ibrahim — EAS Overall AI SPOC
> **Date:** April 2026
> **Status:** Prototype / Design

## Purpose

A seven-agent system that automates the end-to-end software delivery lifecycle for the E-AI-S platform:
**Idea → BRD → SOW → HLD → Code → QA → Test → Release**.

Each agent is a specialized Claude-powered role. A **Supervisor Agent** orchestrates them, manages hand-offs, validates outputs, and consolidates all artefacts back into the E-AI-S `docs/` folder (`BRD.md`, `HLD.md`, `IMPLEMENTATION_PLAN.md`, etc.).

## The Seven Agents

| # | Agent | Role | Primary Output |
|---|-------|------|----------------|
| 1 | **Business Agent** | Introduces new features, reports production issues, generates new BRD requirements | `BRD-<id>.md` (draft) |
| 2 | **BA Agent** | Reviews BRDs and prepares Statement of Work (SOW) | `SOW-<id>.md` |
| 3 | **SA Agent** | Reviews BRD + SOW, challenges the business ask, produces HLD | `HLD-<id>.md` |
| 4 | **Dev Lead Agent** | Challenges HLD + BRD, performs actual code changes / fixes / CRs | Pull request / patch |
| 5 | **Quality Agent** | Verifies code quality, structure, standards, security | `QA-Report-<id>.md` |
| 6 | **Testing Agent** | Generates test cases, runs them, raises defects back to Dev Lead | `TestPlan-<id>.md`, `Bugs-<id>.md` |
| 7 | **Supervisor Agent** | Validates every agent's output, manages the workflow, consolidates docs in the repo | Updated `docs/` folder + run log |

## How It Integrates with E-AI-S

- Reads existing `docs/BRD.md`, `docs/HLD.md`, `docs/IMPLEMENTATION_PLAN.md` as current-state context.
- Writes new artefacts to `docs/cr/<CR-ID>/` and updates the canonical docs via tracked edits.
- Touches the real repo (`js/`, `css/`, `sql/`) through the Dev Lead Agent's file-edit tools.
- Uses the Supabase schema (`sql/001_schema.sql`) as the source of truth for data-model changes.

## Tech Stack

- **Python 3.11+**
- **Claude Agent SDK** (`claude-agent-sdk`) — official Anthropic SDK
- **Claude model:** `claude-sonnet-4-6` (default) / `claude-opus-4-6` for Supervisor
- **Orchestration:** Custom supervisor loop (no external framework) — keeps the runtime lightweight and transparent

## Quick Start

```bash
cd E-AI-S/multi-agent-system
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
python -m src.orchestrator --cr "Add CSV export for leaderboard"
```

## Folder Layout

```
multi-agent-system/
├── README.md
├── requirements.txt
├── src/
│   ├── orchestrator.py        # Supervisor entry point
│   ├── config.py              # Models, prompts, paths
│   ├── shared_state.py        # CR workspace + artefact registry
│   └── agents/
│       ├── base_agent.py      # Common Claude Agent SDK wrapper
│       ├── business_agent.py
│       ├── ba_agent.py
│       ├── sa_agent.py
│       ├── dev_lead_agent.py
│       ├── quality_agent.py
│       ├── testing_agent.py
│       └── supervisor_agent.py
├── docs/
│   ├── MAS_Architecture.docx  # Full design document
│   └── MAS_Pitch.pptx         # Stakeholder pitch deck
├── examples/
│   └── sample_cr_leaderboard_export.md
└── tests/
    └── test_smoke.py
```

## Workflow

```
┌──────────┐   BRD    ┌────┐  SOW  ┌────┐  HLD  ┌──────────┐  code  ┌─────────┐
│ Business │ ───────▶ │ BA │ ────▶ │ SA │ ────▶ │ Dev Lead │ ─────▶ │ Quality │
└──────────┘          └────┘       └────┘       └──────────┘        └─────────┘
     ▲                                                                    │
     │                                                                    ▼
     │                                                              ┌─────────┐
     │                                                              │ Testing │
     │                                                              └────┬────┘
     │                         ┌──────────────┐                          │
     └─────────────────────────│  Supervisor  │ ◀────────────────────────┘
                               └──────────────┘
                       validates, challenges, consolidates
```

See `docs/MAS_Architecture.docx` for the full design.
