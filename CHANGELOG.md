# Changelog

All notable changes to the E-AI-S (EAS AI Adoption Tracker) project are recorded here.

Format: `- YYYY-MM-DD (channel) — description (scope)`
Channels: `claude` · `copilot` · `commit` · `manual`
This changelog is **append-only**. Every task, regardless of origin, must add an entry under `## [Unreleased]` per `.github/copilot-instructions.md` §4.

---

## [Unreleased]

- 2026-04-11 (claude) — Reorganized project layout: moved `index/admin/login/signup/migrate/employee-status.html` into `src/pages/` and rewrote all asset references to `../../css/` and `../../js/` (refactor)
- 2026-04-11 (claude) — Merged project instructions into `.github/copilot-instructions.md` as the single source of truth for Claude + Copilot + commit-authored changes, covering TODO workflow, mandatory skills (UI/UX Pro, Superpowers, Supabase), Supabase MCP rule, full docs sweep, authoritative layout, reference-integrity rule, and commit hygiene (docs)
- 2026-04-11 (claude) — Introduced `CHANGELOG.md` with the doc-update rule enforced for every task communicated via Claude, GitHub Copilot, or git (docs)
- 2026-04-11 (claude) — Updated `README.md` project-structure tree and live-URL paths to reflect `src/pages/` layout and linked docs subfolders (`docs/approval/`, `docs/deployment/`, `docs/phase8/`, `docs/testing/`) (docs)
- 2026-04-11 (claude) — Removed empty `docs/cr/` directory (chore)

## [Prior history]

See git log for commits before `CHANGELOG.md` was introduced.
