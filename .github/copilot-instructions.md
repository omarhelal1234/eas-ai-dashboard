# Project Instructions — E-AI-S (EAS AI Adoption Tracker)

These instructions are the **single source of truth** for how Claude, GitHub Copilot, and any contributor should approach work in this repository. They are binding for every task — whether communicated via Claude, GitHub Copilot Chat, a git commit message, or a pull request description. GitHub Copilot auto-loads this file, and Claude / other assistants are expected to read it at the start of every session.

---

## 1. Mandatory Workflow for Every Task

Before starting **any** task (feature, bug fix, refactor, doc edit, schema change, commit), you MUST:

1. **Validate requirements** — challenge and clarify the request. Ask as many questions as needed to pin down scope, edge cases, acceptance criteria, and dependencies. Do not begin implementation until the requirement is fully understood.
2. **Create a TODO list** using the task-tracking tool. The list MUST contain at minimum:
   - [ ] Validate requirements with clarifying questions
   - [ ] Implement the change
   - [ ] Test and verify functionality
   - [ ] Update documentation (see §4)
   - [ ] Commit and push changes
3. **Select skills** — consult §2 and read the relevant SKILL.md files before writing any code or content.
4. **Implement** — keep changes scoped; do not refactor adjacent code without approval.
5. **Test and verify** — run available test suites, manually exercise the affected pages/endpoints, and confirm expected behavior.
6. **Update documentation** — perform the full sweep in §4.
7. **Commit and push** — use clear, descriptive Conventional-Commit-style messages.

No task is "done" until every box above is checked.

---

## 2. Required Skills

This project relies on three mandatory skills. They live under `.github/skills/` and MUST be read and applied whenever their domain is touched:

| Skill | Location | Use when… |
|---|---|---|
| **UI/UX Pro** | `.github/skills/ui-ux-pro-max/` | Any change to `src/pages/*.html`, `css/*.css`, visual layout, accessibility, or user flows |
| **Superpowers** | `.github/skills/using-superpowers/` | Any multi-step engineering work — planning, refactors, cross-cutting changes, agent workflows |
| **Supabase** | `.github/skills/supabase/` and `.github/skills/supabase-postgres-best-practices/` | Any change to `sql/`, `supabase/functions/`, RLS policies, Edge Functions, or database access in `js/db.js` |

Additional reference: `.github/skills/web-design-guidelines/` for design tokens and component patterns.

**Rule:** If a task touches a skill's domain and you did NOT read the relevant SKILL.md first, the task is incomplete. State which skill(s) you read at the top of your response when the task touches that domain.

---

## 3. Supabase MCP

**All database and backend operations MUST go through the Supabase MCP server.** This includes:

- Schema inspection and migrations
- RLS policy changes
- Edge Function deployments (`supabase/functions/`)
- Querying/seeding data for verification
- Secret management

Do not shell out to `psql`, `curl`, or the raw Supabase REST API when an MCP tool is available. If the MCP is not connected, surface that to the user and request connection before proceeding.

---

## 4. Documentation Sweep (Full, Every Task)

Every task — no matter how small — must end with a **full** documentation sweep:

1. **`README.md`** — update if user-facing behavior, setup, or structure changed.
2. **`CHANGELOG.md`** — append an entry under `## [Unreleased]` in the format:
   ```
   - YYYY-MM-DD (channel) — short description (scope)
   ```
   Where `channel` is one of `claude`, `copilot`, `commit`, `manual`.
3. **`docs/BRD.md`** — update if business requirements or acceptance criteria shifted.
4. **`docs/HLD.md`** — update if architecture, data flow, or component boundaries changed.
5. **`docs/CODE_ARCHITECTURE.md`** — update if file layout, module responsibilities, or public interfaces changed.
6. **`docs/IMPLEMENTATION_NOTES.md`** — append rationale, trade-offs, and gotchas discovered during the task.
7. **`docs/IMPLEMENTATION_PLAN.md`** — update phase/task status if applicable.
8. **Inline code comments** — update JSDoc/comment headers on any function whose signature, contract, or behavior changed.
9. **Skill-specific docs** — if the change affects how a skill is applied, update the skill's SKILL.md or references.

If a document is clearly unaffected, note that in the commit body (e.g. `docs: BRD/HLD unchanged — UI-only fix`). Never silently skip.

---

## 5. Project Layout (authoritative)

```
E-AI-S/
├── .github/
│   ├── copilot-instructions.md    ← THIS FILE (source of truth)
│   ├── agents/                    ← agent definitions
│   └── skills/                    ← UI/UX Pro, Superpowers, Supabase, etc.
├── src/
│   └── pages/                     ← all HTML entry points
│       ├── index.html
│       ├── admin.html
│       ├── login.html
│       ├── signup.html
│       ├── employee-status.html
│       └── migrate.html
├── css/                           ← shared stylesheets (variables.css, dashboard.css)
├── js/                            ← shared client JS (config, auth, db, utils, phase8-submission)
├── server/                        ← optional Node/Express endpoints (adoption-agent-endpoint)
├── supabase/                      ← Edge Functions + project config
├── sql/                           ← schema and migration SQL
├── scripts/                       ← one-off setup and migration scripts
├── deploy/                        ← deployment shell scripts
├── docs/                          ← BRD, HLD, CODE_ARCHITECTURE, phase notes, etc.
│   ├── approval/
│   ├── deployment/
│   ├── phase8/
│   └── testing/
├── CHANGELOG.md
├── README.md
├── package.json
└── .env.example
```

HTML pages reference shared assets using `../../css/` and `../../js/` relative paths. Cross-page navigation within `src/pages/` uses bare filenames (`login.html`, `signup.html`, etc.).

---

## 6. Reference-Integrity Rule

Whenever a file is moved or renamed, you MUST immediately grep the repository for references to the old path and update every one — in HTML, JS, SQL, docs, server routes, deploy scripts, and skill files. Broken references are a build failure even if the build tool does not catch them.

---

## 7. Commit Hygiene

- Conventional-commit style: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`.
- Subject ≤ 72 chars; body wraps at 100.
- Reference the task, issue, or skill where relevant.
- After completion, **push to `origin`** unless the user explicitly requests otherwise.

---

## 8. Channel-Agnostic Enforcement

These instructions apply identically whether the task arrived through:

- **Claude** (desktop, Cowork, API, Claude Code)
- **GitHub Copilot** (Chat, inline, PR review)
- **A git commit or push** (the author is responsible for applying the sweep before pushing)
- **Direct editing** in VS Code or any other editor

Every author is responsible for running §1 → §7 before their change lands in `master`.
