// ============================================================
// EAS Task Logger — Sidebar Webview Provider
// Renders the task entry form and recent tasks in a VS Code sidebar
// ============================================================

import * as vscode from 'vscode';
import { getSession, onDidChangeAuth } from './auth';
import { fetchContext, submitTask, fetchMyTasks, EasContext, MyTask } from './api';
import { gatherIdeContext, matchToolToLov, IdeContext } from './contextDetector';

export class TaskLoggerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'eas.taskLoggerView';

  private _view?: vscode.WebviewView;
  private _context: EasContext | null = null;
  private _ideContext: IdeContext | null = null;

  constructor(private readonly _extensionUri: vscode.Uri) {
    // Listen for auth changes to refresh the view
    onDidChangeAuth(() => {
      if (this._view) {
        this._updateWebview();
      }
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'submitTask':
          await this._handleSubmitTask(message.data);
          break;
        case 'refreshContext':
          await this._loadContext();
          break;
        case 'refreshTasks':
          await this._loadMyTasks();
          break;
        case 'signIn':
          vscode.commands.executeCommand('eas.signIn');
          break;
      }
    });

    this._updateWebview();
  }

  /** Refresh the sidebar view externally */
  public refresh(): void {
    if (this._view) {
      this._updateWebview();
    }
  }

  private async _updateWebview(): Promise<void> {
    if (!this._view) return;

    const session = getSession();
    if (!session) {
      this._view.webview.html = this._getSignInHtml();
      return;
    }

    // Show loading state
    this._view.webview.html = this._getLoadingHtml();

    // Load context and tasks
    await this._loadContext();
  }

  private async _loadContext(): Promise<void> {
    if (!this._view) return;
    try {
      const [serverCtx, ideCtx] = await Promise.all([
        fetchContext(),
        gatherIdeContext(),
      ]);
      this._context = serverCtx;
      this._ideContext = ideCtx;
      const tasks = await fetchMyTasks(10);
      this._view.webview.html = this._getMainHtml(this._context, tasks.tasks, this._ideContext);
    } catch (err) {
      this._view.webview.html = this._getErrorHtml((err as Error).message);
    }
  }

  private async _loadMyTasks(): Promise<void> {
    if (!this._view || !this._context) return;
    try {
      const tasks = await fetchMyTasks(10);
      this._view.webview.html = this._getMainHtml(this._context, tasks.tasks, this._ideContext);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to refresh tasks: ${(err as Error).message}`);
    }
  }

  private async _handleSubmitTask(data: Record<string, unknown>): Promise<void> {
    if (!this._view) return;

    try {
      const result = await submitTask({
        taskDescription: data.taskDescription as string,
        category: data.category as string,
        aiTool: data.aiTool as string,
        timeWithoutAi: parseFloat(data.timeWithoutAi as string),
        timeWithAi: parseFloat(data.timeWithAi as string),
        qualityRating: data.qualityRating ? parseFloat(data.qualityRating as string) : undefined,
        project: data.project as string || undefined,
        projectCode: data.projectCode as string || undefined,
        promptUsed: data.promptUsed as string || undefined,
        notes: data.notes as string || undefined,
      });

      if (result.success) {
        const timeSaved = result.task.timeSaved;
        const approvalStatus = result.approval?.status || 'pending';
        vscode.window.showInformationMessage(
          `Task logged! Saved ${timeSaved}h. Approval: ${approvalStatus}`
        );
        // Refresh to show the new task
        await this._loadContext();
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to submit task: ${(err as Error).message}`);
    }
  }

  // ---- HTML Generators ----

  private _getSignInHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this._getBaseStyles()}</style>
</head>
<body>
  <div class="center-container">
    <div class="logo">📋</div>
    <h2>EAS Task Logger</h2>
    <p class="subtitle">Log your AI adoption tasks directly from VS Code</p>
    <button class="btn btn-primary" onclick="signIn()">Sign In</button>
    <p class="hint">Use your EAS dashboard credentials</p>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function signIn() { vscode.postMessage({ command: 'signIn' }); }
  </script>
</body>
</html>`;
  }

  private _getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>${this._getBaseStyles()}</style>
</head>
<body>
  <div class="center-container">
    <div class="spinner"></div>
    <p>Loading your workspace...</p>
  </div>
</body>
</html>`;
  }

  private _getErrorHtml(message: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>${this._getBaseStyles()}</style>
</head>
<body>
  <div class="center-container">
    <div class="error-icon">⚠️</div>
    <h3>Something went wrong</h3>
    <p class="error-text">${this._escapeHtml(message)}</p>
    <button class="btn btn-primary" onclick="retry()">Retry</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function retry() { vscode.postMessage({ command: 'refreshContext' }); }
  </script>
</body>
</html>`;
  }

  private _getMainHtml(ctx: EasContext, tasks: MyTask[], ideCtx?: IdeContext | null): string {
    // Auto-detect best matches from IDE context
    const autoTool = ideCtx ? matchToolToLov(ideCtx.detectedAiTools, ctx.aiTools) : null;
    const autoCategory = ideCtx?.suggestedCategory || null;
    const autoProject = this._matchProject(ctx, ideCtx);

    const categoryOptions = ctx.categories.map(c => {
      const selected = autoCategory === c ? ' selected' : '';
      return `<option value="${this._escapeHtml(c)}"${selected}>${this._escapeHtml(c)}</option>`;
    }).join('');
    const aiToolOptions = ctx.aiTools.map(t => {
      const label = t.isLicensed ? `${t.value} ⭐` : t.value;
      const detected = autoTool === t.value ? ' 🔍' : '';
      const selected = autoTool === t.value ? ' selected' : '';
      return `<option value="${this._escapeHtml(t.value)}"${selected}>${this._escapeHtml(label)}${detected}</option>`;
    }).join('');
    const projectOptions = ctx.projects.map(p => {
      const selected = autoProject === p.name ? ' selected' : '';
      return `<option value="${this._escapeHtml(p.name)}" data-code="${this._escapeHtml(p.code || '')}"${selected}>${this._escapeHtml(p.name)}</option>`;
    }).join('');

    const quarterLabel = ctx.activeQuarter?.label || 'No active quarter';
    const tasksHtml = tasks.length > 0
      ? tasks.map(t => this._renderTaskCard(t)).join('')
      : '<p class="empty-state">No tasks logged yet. Submit your first task above!</p>';

    // Build context detection banner
    const contextParts: string[] = [];
    if (autoTool) contextParts.push(`🔧 ${autoTool}`);
    if (ideCtx?.git.branch) contextParts.push(`🌿 ${ideCtx.git.branch}`);
    if (ideCtx?.editor.language) contextParts.push(`📄 ${ideCtx.editor.language}`);
    if (ideCtx?.datetime.weekNumber) contextParts.push(`📅 W${ideCtx.datetime.weekNumber}`);
    const contextBannerHtml = contextParts.length > 0
      ? `<div class="context-banner"><span class="context-label">Auto-detected:</span> ${contextParts.map(p => `<span class="context-chip">${p}</span>`).join('')}</div>`
      : '';

    // Auto-fill description suggestion
    const suggestedDesc = ideCtx?.suggestedDescription || '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this._getBaseStyles()}${this._getFormStyles()}</style>
</head>
<body>
  <div class="header">
    <div class="user-info">
      <span class="user-name">${this._escapeHtml(ctx.user.name)}</span>
      <span class="user-practice">${this._escapeHtml(ctx.user.practice)}</span>
    </div>
    <span class="quarter-badge">${this._escapeHtml(quarterLabel)}</span>
  </div>

  ${contextBannerHtml}

  <!-- Tab Navigation -->
  <div class="tabs">
    <button class="tab active" data-tab="submit" onclick="switchTab('submit')">Log Task</button>
    <button class="tab" data-tab="tasks" onclick="switchTab('tasks')">My Tasks (${tasks.length})</button>
  </div>

  <!-- Submit Tab -->
  <div id="tab-submit" class="tab-content active">
    <form id="taskForm" onsubmit="handleSubmit(event)">
      <div class="form-group">
        <label for="taskDescription">Task Description *</label>
        <textarea id="taskDescription" required minlength="10" rows="3"
          placeholder="Describe what you accomplished using AI...">${this._escapeHtml(suggestedDesc)}</textarea>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="category">Category *</label>
          <select id="category" required>
            <option value="">Select...</option>
            ${categoryOptions}
          </select>
        </div>
        <div class="form-group">
          <label for="aiTool">AI Tool *</label>
          <select id="aiTool" required>
            <option value="">Select...</option>
            ${aiToolOptions}
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="timeWithoutAi">Time Without AI (h) *</label>
          <input type="number" id="timeWithoutAi" required min="0" step="0.25" placeholder="e.g. 4" />
        </div>
        <div class="form-group">
          <label for="timeWithAi">Time With AI (h) *</label>
          <input type="number" id="timeWithAi" required min="0" step="0.25" placeholder="e.g. 1.5" />
        </div>
      </div>

      <div class="time-saved-preview" id="timeSavedPreview"></div>

      <div class="form-row">
        <div class="form-group">
          <label for="project">Project</label>
          <select id="project">
            <option value="">None</option>
            ${projectOptions}
          </select>
        </div>
        <div class="form-group">
          <label for="qualityRating">Quality (1-5)</label>
          <input type="number" id="qualityRating" min="1" max="5" step="0.5" placeholder="e.g. 4" />
        </div>
      </div>

      <div class="form-group collapsible">
        <button type="button" class="collapse-toggle" onclick="toggleAdvanced()">
          ▶ Advanced Fields
        </button>
        <div id="advancedFields" class="collapse-content" style="display:none;">
          <div class="form-group">
            <label for="promptUsed">Prompt Used</label>
            <textarea id="promptUsed" rows="2" placeholder="Paste the AI prompt you used..."></textarea>
          </div>
          <div class="form-group">
            <label for="notes">Notes</label>
            <textarea id="notes" rows="2" placeholder="Any additional notes..."></textarea>
          </div>
        </div>
      </div>

      <button type="submit" class="btn btn-primary btn-full" id="submitBtn">
        Submit Task
      </button>
    </form>
  </div>

  <!-- Tasks Tab -->
  <div id="tab-tasks" class="tab-content">
    <div class="tasks-header">
      <h3>Recent Tasks</h3>
      <button class="btn btn-small" onclick="refreshTasks()">↻ Refresh</button>
    </div>
    <div class="tasks-list">
      ${tasksHtml}
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Tab switching
    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
      document.getElementById('tab-' + tab).classList.add('active');
    }

    // Time saved preview
    const timeWithoutEl = document.getElementById('timeWithoutAi');
    const timeWithEl = document.getElementById('timeWithAi');
    const previewEl = document.getElementById('timeSavedPreview');

    function updateTimeSaved() {
      const without = parseFloat(timeWithoutEl.value) || 0;
      const withAi = parseFloat(timeWithEl.value) || 0;
      if (without > 0 && withAi >= 0) {
        const saved = without - withAi;
        const pct = ((saved / without) * 100).toFixed(1);
        const cls = saved >= 0 ? 'positive' : 'negative';
        previewEl.innerHTML = '<span class="' + cls + '">Time saved: ' + saved.toFixed(2) + 'h (' + pct + '% efficiency)</span>';
        previewEl.style.display = 'block';
      } else {
        previewEl.style.display = 'none';
      }
    }
    timeWithoutEl.addEventListener('input', updateTimeSaved);
    timeWithEl.addEventListener('input', updateTimeSaved);

    // Form submission
    function handleSubmit(e) {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = 'Submitting...';

      const projectEl = document.getElementById('project');
      const selectedOption = projectEl.options[projectEl.selectedIndex];

      vscode.postMessage({
        command: 'submitTask',
        data: {
          taskDescription: document.getElementById('taskDescription').value,
          category: document.getElementById('category').value,
          aiTool: document.getElementById('aiTool').value,
          timeWithoutAi: document.getElementById('timeWithoutAi').value,
          timeWithAi: document.getElementById('timeWithAi').value,
          qualityRating: document.getElementById('qualityRating').value || undefined,
          project: projectEl.value || undefined,
          projectCode: selectedOption ? selectedOption.dataset.code : undefined,
          promptUsed: document.getElementById('promptUsed').value || undefined,
          notes: document.getElementById('notes').value || undefined,
        }
      });

      // Re-enable after a delay (actual result comes via webview refresh)
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Submit Task';
      }, 3000);
    }

    // Advanced fields toggle
    function toggleAdvanced() {
      const el = document.getElementById('advancedFields');
      const toggle = el.previousElementSibling;
      if (el.style.display === 'none') {
        el.style.display = 'block';
        toggle.textContent = '▼ Advanced Fields';
      } else {
        el.style.display = 'none';
        toggle.textContent = '▶ Advanced Fields';
      }
    }

    // Refresh tasks
    function refreshTasks() {
      vscode.postMessage({ command: 'refreshTasks' });
    }
  </script>
</body>
</html>`;
  }

  private _renderTaskCard(task: MyTask): string {
    const statusClass = this._getStatusClass(task.approvalStatus || '');
    const timeSaved = (task.timeWithoutAi || 0) - (task.timeWithAi || 0);
    const date = new Date(task.createdAt).toLocaleDateString();

    return `
    <div class="task-card">
      <div class="task-header">
        <span class="task-tool">${this._escapeHtml(task.aiTool || '')}</span>
        <span class="status-badge ${statusClass}">${this._escapeHtml(task.approvalStatus || 'pending')}</span>
      </div>
      <p class="task-description">${this._escapeHtml((task.description || '').substring(0, 120))}${(task.description || '').length > 120 ? '...' : ''}</p>
      <div class="task-meta">
        <span class="task-category">${this._escapeHtml(task.category || '')}</span>
        <span class="task-saved">💾 ${timeSaved.toFixed(1)}h saved</span>
        <span class="task-date">${date}</span>
      </div>
    </div>`;
  }

  /** Match workspace/repo name to a project from the server context */
  private _matchProject(ctx: EasContext, ideCtx?: IdeContext | null): string | null {
    if (!ideCtx) return null;

    const config = vscode.workspace.getConfiguration('eas');
    const defaultProject = config.get<string>('defaultProject') || '';
    if (defaultProject) {
      const match = ctx.projects.find(p => p.name === defaultProject);
      if (match) return match.name;
    }

    // Try repo name match
    if (ideCtx.git.repoName) {
      const repoMatch = ctx.projects.find(p =>
        p.name.toLowerCase().includes(ideCtx.git.repoName!.toLowerCase()) ||
        (p.code && p.code.toLowerCase() === ideCtx.git.repoName!.toLowerCase())
      );
      if (repoMatch) return repoMatch.name;
    }

    // Try workspace name match
    if (ideCtx.editor.workspaceName) {
      const wsMatch = ctx.projects.find(p =>
        p.name.toLowerCase().includes(ideCtx.editor.workspaceName!.toLowerCase())
      );
      if (wsMatch) return wsMatch.name;
    }

    // If only one project, auto-select
    if (ctx.projects.length === 1) return ctx.projects[0].name;

    return null;
  }

  private _getStatusClass(status: string): string {
    switch (status) {
      case 'approved': return 'status-approved';
      case 'rejected': return 'status-rejected';
      case 'ai_review': return 'status-ai';
      case 'spoc_review': return 'status-spoc';
      case 'admin_review': return 'status-admin';
      default: return 'status-pending';
    }
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ---- Styles ----

  private _getBaseStyles(): string {
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        padding: 12px;
      }
      .center-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 200px;
        text-align: center;
        gap: 12px;
      }
      .logo { font-size: 48px; }
      h2 { font-size: 18px; font-weight: 600; }
      h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
      .subtitle { color: var(--vscode-descriptionForeground); font-size: 12px; }
      .hint { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 4px; }
      .btn {
        padding: 6px 14px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-family: inherit;
        transition: opacity 0.2s;
      }
      .btn:hover { opacity: 0.9; }
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
      .btn-small { padding: 3px 8px; font-size: 11px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .btn-full { width: 100%; padding: 8px; }
      .error-icon { font-size: 36px; }
      .error-text { color: var(--vscode-errorForeground); font-size: 12px; }
      .spinner {
        width: 24px; height: 24px;
        border: 3px solid var(--vscode-progressBar-background);
        border-top: 3px solid transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;
  }

  private _getFormStyles(): string {
    return `
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        margin-bottom: 8px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }
      .user-info { display: flex; flex-direction: column; }
      .user-name { font-weight: 600; font-size: 13px; }
      .user-practice { font-size: 11px; color: var(--vscode-descriptionForeground); }
      .quarter-badge {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
      .tabs {
        display: flex;
        gap: 0;
        margin-bottom: 12px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }
      .tab {
        flex: 1;
        padding: 6px 12px;
        border: none;
        background: none;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        font-size: 12px;
        font-family: inherit;
        border-bottom: 2px solid transparent;
        transition: all 0.2s;
      }
      .tab:hover { color: var(--vscode-foreground); }
      .tab.active {
        color: var(--vscode-foreground);
        border-bottom-color: var(--vscode-focusBorder);
        font-weight: 600;
      }
      .tab-content { display: none; }
      .tab-content.active { display: block; }
      .form-group { margin-bottom: 10px; }
      .form-group label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        margin-bottom: 3px;
        color: var(--vscode-foreground);
      }
      .form-group input,
      .form-group select,
      .form-group textarea {
        width: 100%;
        padding: 5px 8px;
        font-size: 12px;
        font-family: inherit;
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border-radius: 3px;
        outline: none;
      }
      .form-group input:focus,
      .form-group select:focus,
      .form-group textarea:focus {
        border-color: var(--vscode-focusBorder);
      }
      .form-row { display: flex; gap: 8px; }
      .form-row .form-group { flex: 1; }
      .time-saved-preview {
        display: none;
        padding: 6px 10px;
        margin-bottom: 10px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        background: var(--vscode-editor-inactiveSelectionBackground);
      }
      .time-saved-preview .positive { color: var(--vscode-testing-iconPassed); }
      .time-saved-preview .negative { color: var(--vscode-testing-iconFailed); }
      .collapse-toggle {
        background: none;
        border: none;
        color: var(--vscode-textLink-foreground);
        cursor: pointer;
        font-size: 11px;
        padding: 4px 0;
        font-family: inherit;
      }
      .collapse-content { margin-top: 8px; }
      .tasks-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .tasks-list { display: flex; flex-direction: column; gap: 8px; }
      .task-card {
        padding: 8px 10px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 4px;
        background: var(--vscode-editor-background);
      }
      .task-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }
      .task-tool {
        font-size: 11px;
        font-weight: 600;
        color: var(--vscode-textLink-foreground);
      }
      .status-badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 8px;
        font-weight: 600;
        text-transform: uppercase;
      }
      .status-approved { background: rgba(40, 167, 69, 0.15); color: var(--vscode-testing-iconPassed); }
      .status-rejected { background: rgba(220, 53, 69, 0.15); color: var(--vscode-testing-iconFailed); }
      .status-ai { background: rgba(0, 123, 255, 0.15); color: var(--vscode-textLink-foreground); }
      .status-spoc { background: rgba(255, 193, 7, 0.15); color: var(--vscode-editorWarning-foreground); }
      .status-admin { background: rgba(255, 193, 7, 0.15); color: var(--vscode-editorWarning-foreground); }
      .status-pending { background: var(--vscode-editor-inactiveSelectionBackground); color: var(--vscode-descriptionForeground); }
      .task-description {
        font-size: 12px;
        margin-bottom: 4px;
        line-height: 1.4;
        color: var(--vscode-foreground);
      }
      .task-meta {
        display: flex;
        gap: 10px;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }
      .task-saved { font-weight: 600; }
      .empty-state {
        text-align: center;
        padding: 24px 16px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .context-banner {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        margin-bottom: 8px;
        border-radius: 4px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        font-size: 11px;
      }
      .context-label {
        font-weight: 600;
        color: var(--vscode-foreground);
        margin-right: 2px;
      }
      .context-chip {
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        font-size: 10px;
        white-space: nowrap;
      }
    `;
  }
}
