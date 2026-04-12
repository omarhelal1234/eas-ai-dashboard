# Skill: IDE Context Detection

## Purpose

Automatically gathers developer work context from the VS Code environment to pre-fill task logging forms, reducing friction to near-zero.

## When to use

- Any time the VS Code extension's sidebar or Quick Log wizard is invoked
- When the user opens the "Log Task" form in the sidebar panel
- When `EAS: Quick Log Task` is run from the Command Palette

## What gets auto-detected

| Signal | Source | Auto-Fills |
|---|---|---|
| **AI Tool** | Installed VS Code extensions (`github.copilot`, `tabnine.tabnine-vscode`, `sourcegraph.cody-ai`, etc.) | AI Tool dropdown — detected tool is promoted to top of list |
| **File Language** | Active editor tab's `languageId` | Category (e.g., `typescript` → "Code Generation", `sql` → "Data Analysis", `markdown` → "Content Writing") |
| **Git Branch** | Built-in Git extension API | Task description hint (e.g., `on branch "feature/auth-flow"`) |
| **Last Commit** | `repo.log({ maxEntries: 5 })` | Task description context suffix |
| **Pending Changes** | `repo.state.indexChanges` + `workingTreeChanges` | Indicates active work session |
| **Workspace / Repo Name** | `workspaceFolders[0].name` / Git root URI | Project selection (fuzzy match against EAS project list) |
| **Date / Week / Quarter** | `new Date()` + ISO week calculation | Quarter auto-selection, `weekNumber` on submission |
| **Session Duration** | Extension activation timestamp | Informational (shown in banner) |

## Architecture

```
vscode-extension/src/
├── contextDetector.ts  ← Core module (this skill)
├── extension.ts        ← Calls resetSessionTimer() on activation
├── quickLog.ts         ← Uses gatherIdeContext() + matchToolToLov()
├── sidebar.ts          ← Uses gatherIdeContext() + matchToolToLov()
├── api.ts              ← TaskSubmission now includes weekNumber
├── auth.ts             ← Unchanged
└── statusBar.ts        ← Unchanged
```

## Key Functions

### `gatherIdeContext(): Promise<IdeContext>`
Main entry point. Fetches git, editor, AI tools, datetime, and session data in parallel. Returns a full `IdeContext` object.

### `matchToolToLov(detected, lovTools): string | null`
Matches detected AI extensions against the server's LOV list. Uses exact match first, then partial/fuzzy match.

### `resetSessionTimer(): void`
Resets the session start time. Called once during extension activation.

## Supported AI Extensions

The module recognizes 20+ AI extension IDs including:
- GitHub Copilot (`github.copilot`, `github.copilot-chat`)
- Tabnine (`tabnine.tabnine-vscode`)
- Amazon Q (`amazonwebservices.amazon-q-vscode`)
- Cody (`sourcegraph.cody-ai`)
- Continue (`continue.continue`)
- Codeium (`codeium.codeium`)
- Cursor, Supermaven, Claude Dev, Cline, Windsurf, Pieces, IntelliCode, and more

## Language → Category Mapping

| Languages | Category |
|---|---|
| TypeScript, JavaScript, Python, Java, C#, Go, Rust, etc. | Code Generation |
| SQL | Data Analysis |
| Markdown, Plain Text | Content Writing |
| HTML, CSS, SCSS | Code Generation |
| Dockerfile, Shell, PowerShell | Code Generation |
| YAML, JSON | Code Generation |

## Web Dashboard Integration

A "VS Code Extension" page is added to the web dashboard under **Resources** in the sidebar navigation. It includes:
- Install CTA button (copies `code --install-extension` command)
- Feature cards showing key capabilities
- Step-by-step installation guide
- Auto-detection reference table
- Extension settings reference

The page is visible to all authenticated roles (admin, spoc, contributor).
