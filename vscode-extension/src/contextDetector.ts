// ============================================================
// EAS Task Logger — IDE Context Detector
// Auto-detects developer work context from VS Code environment:
//   - Git branch, recent commits, repo name
//   - Active file, language, workspace
//   - AI extensions (Copilot, Tabnine, Cody, etc.)
//   - Current date, week number, quarter
//   - Time tracking (session duration)
// ============================================================

import * as vscode from 'vscode';

// ---- Types ----

export interface IdeContext {
  /** Git info */
  git: {
    branch: string | null;
    repoName: string | null;
    lastCommitMessage: string | null;
    recentCommitMessages: string[];
    hasPendingChanges: boolean;
  };
  /** Current editor info */
  editor: {
    activeFile: string | null;
    language: string | null;
    workspaceName: string | null;
    workspacePath: string | null;
    selection: string | null;
  };
  /** Detected AI tools from installed extensions */
  detectedAiTools: DetectedTool[];
  /** Date/time context */
  datetime: {
    date: string;          // YYYY-MM-DD
    weekNumber: number;    // ISO week number
    quarter: string;       // e.g. "Q2 2026"
    dayOfWeek: string;     // e.g. "Monday"
    timestamp: string;     // ISO 8601
  };
  /** Session tracking */
  session: {
    startedAt: string;    // ISO 8601 when extension activated
    durationMinutes: number;
  };
  /** Auto-generated task description suggestion */
  suggestedDescription: string | null;
  /** Auto-detected category hint */
  suggestedCategory: string | null;
}

export interface DetectedTool {
  name: string;
  extensionId: string;
  isActive: boolean;
}

// Known AI extension IDs → friendly tool names
const AI_EXTENSION_MAP: Record<string, string> = {
  'github.copilot': 'GitHub Copilot',
  'github.copilot-chat': 'GitHub Copilot',
  'github.copilot-nightly': 'GitHub Copilot',
  'tabnine.tabnine-vscode': 'Tabnine',
  'amazonwebservices.aws-toolkit-vscode': 'Amazon CodeWhisperer',
  'amazonwebservices.amazon-q-vscode': 'Amazon Q',
  'sourcegraph.cody-ai': 'Cody',
  'continue.continue': 'Continue',
  'codeium.codeium': 'Codeium',
  'blackboxapp.blackbox': 'Blackbox AI',
  'cursor.cursor': 'Cursor',
  'anysphere.cursor': 'Cursor',
  'phind.phind': 'Phind',
  'pieces.pieces-copilot': 'Pieces Copilot',
  'supermaven.supermaven': 'Supermaven',
  'anthropic.claude-dev': 'Claude Dev',
  'saoudrizwan.claude-dev': 'Claude Dev',
  'winsurf.windsurf': 'Windsurf',
  'cline.cline': 'Cline',
  'ms-toolsai.jupyter': 'Jupyter AI',
  'ms-toolsai.vscode-ai': 'Azure AI',
  'visualstudioexptteam.vscodeintellicode': 'IntelliCode',
  'github.copilot-labs': 'GitHub Copilot Labs',
};

// Language to category mapping heuristic
const LANGUAGE_CATEGORY_MAP: Record<string, string> = {
  'typescript': 'Code Generation',
  'javascript': 'Code Generation',
  'python': 'Code Generation',
  'java': 'Code Generation',
  'csharp': 'Code Generation',
  'go': 'Code Generation',
  'rust': 'Code Generation',
  'cpp': 'Code Generation',
  'c': 'Code Generation',
  'php': 'Code Generation',
  'ruby': 'Code Generation',
  'swift': 'Code Generation',
  'kotlin': 'Code Generation',
  'dart': 'Code Generation',
  'sql': 'Data Analysis',
  'markdown': 'Content Writing',
  'html': 'Code Generation',
  'css': 'Code Generation',
  'scss': 'Code Generation',
  'json': 'Code Generation',
  'yaml': 'Code Generation',
  'dockerfile': 'Code Generation',
  'shellscript': 'Code Generation',
  'powershell': 'Code Generation',
  'plaintext': 'Content Writing',
};

// ---- Session tracking ----
let _sessionStart: Date = new Date();

/**
 * Reset session timer (call on activation)
 */
export function resetSessionTimer(): void {
  _sessionStart = new Date();
}

// ---- Core Functions ----

/**
 * Gather the full IDE context snapshot.
 * This is the main entry point — call it before showing the task form.
 */
export async function gatherIdeContext(): Promise<IdeContext> {
  const [git, editor, detectedAiTools] = await Promise.all([
    getGitContext(),
    getEditorContext(),
    detectAiTools(),
  ]);

  const datetime = getDateTimeContext();
  const session = getSessionContext();
  const suggestedDescription = buildSuggestedDescription(git, editor, detectedAiTools);
  const suggestedCategory = guessCategoryFromLanguage(editor.language);

  return {
    git,
    editor,
    detectedAiTools,
    datetime,
    session,
    suggestedDescription,
    suggestedCategory,
  };
}

/**
 * Get Git-related context from the built-in Git extension.
 */
async function getGitContext(): Promise<IdeContext['git']> {
  const result: IdeContext['git'] = {
    branch: null,
    repoName: null,
    lastCommitMessage: null,
    recentCommitMessages: [],
    hasPendingChanges: false,
  };

  try {
    // Access the built-in Git extension
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) return result;

    const git = gitExtension.isActive
      ? gitExtension.exports
      : await gitExtension.activate();

    const api = git.getAPI(1);
    if (!api || api.repositories.length === 0) return result;

    const repo = api.repositories[0];

    // Branch
    result.branch = repo.state?.HEAD?.name || null;

    // Repo name from the root URI
    if (repo.rootUri) {
      const parts = repo.rootUri.path.split('/');
      result.repoName = parts[parts.length - 1] || null;
    }

    // Pending changes
    const indexChanges = repo.state?.indexChanges?.length || 0;
    const workingChanges = repo.state?.workingTreeChanges?.length || 0;
    result.hasPendingChanges = indexChanges + workingChanges > 0;

    // Recent commit messages (last 5)
    try {
      const log = await repo.log({ maxEntries: 5 });
      if (log && log.length > 0) {
        result.lastCommitMessage = log[0].message?.split('\n')[0] || null;
        result.recentCommitMessages = log
          .map((c: { message?: string }) => c.message?.split('\n')[0] || '')
          .filter(Boolean);
      }
    } catch {
      // log() might not be available in all versions
    }
  } catch {
    // Git extension not available — that's fine
  }

  return result;
}

/**
 * Get current editor/workspace context.
 */
function getEditorContext(): IdeContext['editor'] {
  const editor = vscode.window.activeTextEditor;
  const workspaceFolders = vscode.workspace.workspaceFolders;

  return {
    activeFile: editor?.document.fileName
      ? vscode.workspace.asRelativePath(editor.document.fileName)
      : null,
    language: editor?.document.languageId || null,
    workspaceName: workspaceFolders?.[0]?.name || null,
    workspacePath: workspaceFolders?.[0]?.uri.fsPath || null,
    selection: editor?.selection && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection).substring(0, 200)
      : null,
  };
}

/**
 * Detect installed AI extensions.
 */
function detectAiTools(): DetectedTool[] {
  const detected: DetectedTool[] = [];

  for (const [extId, toolName] of Object.entries(AI_EXTENSION_MAP)) {
    const ext = vscode.extensions.getExtension(extId);
    if (ext) {
      // Deduplicate by tool name (e.g. copilot + copilot-chat → one entry)
      if (!detected.some(d => d.name === toolName)) {
        detected.push({
          name: toolName,
          extensionId: extId,
          isActive: ext.isActive,
        });
      }
    }
  }

  return detected;
}

/**
 * Get current date/time context with auto-detected quarter and week.
 */
function getDateTimeContext(): IdeContext['datetime'] {
  const now = new Date();

  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  const quarter = Math.ceil(month / 3);

  return {
    date: formatDate(now),
    weekNumber: getISOWeekNumber(now),
    quarter: `Q${quarter} ${year}`,
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
    timestamp: now.toISOString(),
  };
}

/**
 * Get session timing info.
 */
function getSessionContext(): IdeContext['session'] {
  const now = new Date();
  const durationMs = now.getTime() - _sessionStart.getTime();

  return {
    startedAt: _sessionStart.toISOString(),
    durationMinutes: Math.round(durationMs / 60000),
  };
}

// ---- Suggestion Builders ----

/**
 * Build a suggested task description from available context.
 */
function buildSuggestedDescription(
  git: IdeContext['git'],
  editor: IdeContext['editor'],
  tools: DetectedTool[]
): string | null {
  const parts: string[] = [];

  // AI tool prefix
  const activeTool = tools.find(t => t.isActive);
  if (activeTool) {
    parts.push(`Used ${activeTool.name}`);
  }

  // What they're working on
  if (editor.language && editor.activeFile) {
    const fileShort = editor.activeFile.split('/').pop() || editor.activeFile;
    parts.push(`working on ${fileShort}`);
  } else if (editor.workspaceName) {
    parts.push(`in ${editor.workspaceName} project`);
  }

  // Git context for specificity
  if (git.branch && git.branch !== 'main' && git.branch !== 'master') {
    parts.push(`on branch "${git.branch}"`);
  }

  if (git.lastCommitMessage) {
    parts.push(`— recent: "${git.lastCommitMessage}"`);
  }

  if (parts.length === 0) return null;

  return parts.join(' ');
}

/**
 * Guess a task category from the file language.
 */
function guessCategoryFromLanguage(language: string | null): string | null {
  if (!language) return null;
  return LANGUAGE_CATEGORY_MAP[language] || null;
}

// ---- Utility ----

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Calculate ISO 8601 week number.
 */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Match a detected AI tool name against the LOV list from the server.
 * Returns the best match or null.
 */
export function matchToolToLov(
  detected: DetectedTool[],
  lovTools: Array<{ value: string; isLicensed: boolean }>
): string | null {
  for (const d of detected) {
    // Exact match
    const exact = lovTools.find(
      l => l.value.toLowerCase() === d.name.toLowerCase()
    );
    if (exact) return exact.value;

    // Partial match (tool name contains LOV value or vice versa)
    const partial = lovTools.find(
      l =>
        l.value.toLowerCase().includes(d.name.toLowerCase()) ||
        d.name.toLowerCase().includes(l.value.toLowerCase())
    );
    if (partial) return partial.value;
  }
  return null;
}
