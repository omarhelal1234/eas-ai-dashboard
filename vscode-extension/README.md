# EAS AI Task Logger — VS Code Extension

Log your AI adoption tasks directly from VS Code to the EAS AI Dashboard without switching contexts.

## Features

- **Sidebar Panel** — Full task entry form with dropdowns for categories, AI tools, and projects
- **Quick Log via Command Palette** — Step-through wizard: `Ctrl+Shift+P` → `EAS: Quick Log Task`
- **Status Bar** — See your login status and task count at a glance
- **Full Approval Workflow** — Tasks go through the same AI validation → SPOC → Admin approval pipeline
- **My Tasks View** — Track your recent submissions and their approval status

## Getting Started

### 1. Install the Extension

```bash
cd vscode-extension
npm install
npm run compile
```

Then install via VS Code:
- Press `F5` to launch a development Extension Host, OR
- Run `npm run package` to create a `.vsix` file and install it via `Extensions → ⋯ → Install from VSIX`

### 2. Sign In

- Click the **EAS Task Logger** icon in the Activity Bar (left sidebar), OR
- Use `Ctrl+Shift+P` → `EAS: Sign In`
- Enter your EAS dashboard email and password

### 3. Log a Task

**Sidebar (full form):**
1. Click the EAS icon in the Activity Bar
2. Fill in the task form (description, AI tool, category, time estimates)
3. Click **Submit Task**

**Command Palette (quick):**
1. `Ctrl+Shift+P` → `EAS: Quick Log Task`
2. Follow the 5-step wizard
3. Confirm and submit

### 4. Track Status

Switch to the **My Tasks** tab in the sidebar to see your submissions and their approval status.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `eas.supabaseUrl` | `https://apcfnzbiylhgiutcjigg.supabase.co` | Supabase project URL |
| `eas.supabaseAnonKey` | *(pre-configured)* | Supabase anonymous key (safe — RLS enforced) |
| `eas.defaultProject` | `""` | Default project name for quick-log |
| `eas.autoDetectTool` | `false` | (Future) Auto-detect AI tool from active extensions |

## Commands

| Command | Description |
|---|---|
| `EAS: Sign In` | Authenticate with EAS credentials |
| `EAS: Sign Out` | Clear stored session |
| `EAS: Quick Log Task` | Open the quick-log wizard |
| `EAS: Open Task Logger` | Focus the sidebar panel |
| `EAS: Refresh My Tasks` | Reload task list |

## Architecture

```
vscode-extension/
├── src/
│   ├── extension.ts    — Entry point, command registration
│   ├── auth.ts         — Supabase Auth (email/password → JWT)
│   ├── api.ts          — Edge Function API client
│   ├── sidebar.ts      — Webview sidebar panel
│   ├── quickLog.ts     — Command Palette wizard
│   └── statusBar.ts    — Status bar item
├── media/
│   └── sidebar-icon.svg
├── package.json        — Extension manifest
└── tsconfig.json
```

The extension communicates with the `ide-task-log` Supabase Edge Function, which handles:
- JWT authentication
- Task creation with `source: 'ide'`
- AI validation via the existing `ai-validate` Edge Function
- Multi-layer approval workflow routing
- Activity logging

## Development

```bash
cd vscode-extension
npm install
npm run watch    # Compile on change
# Press F5 in VS Code to launch Extension Development Host
```
