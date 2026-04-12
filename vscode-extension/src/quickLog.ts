// ============================================================
// EAS Task Logger — Quick Log Command
// Step-through Command Palette wizard for rapid task logging
// ============================================================

import * as vscode from 'vscode';
import { getSession } from './auth';
import { fetchContext, submitTask, EasContext } from './api';

/**
 * Run the quick-log wizard via Command Palette.
 * Minimal step-through flow: description → AI tool → time without → time with → quality.
 * Auto-fills employee info, active quarter, and practice from the user's profile.
 */
export async function quickLogTask(): Promise<void> {
  const session = getSession();
  if (!session) {
    vscode.window.showWarningMessage('EAS: Please sign in first.', 'Sign In').then(choice => {
      if (choice === 'Sign In') {
        vscode.commands.executeCommand('eas.signIn');
      }
    });
    return;
  }

  // Fetch context to get LOV values
  let ctx: EasContext;
  try {
    ctx = await fetchContext();
  } catch (err) {
    vscode.window.showErrorMessage(`EAS: Failed to load context — ${(err as Error).message}`);
    return;
  }

  if (!ctx.activeQuarter) {
    vscode.window.showErrorMessage('EAS: No active quarter found. Contact an administrator.');
    return;
  }

  if (ctx.activeQuarter.isLocked) {
    vscode.window.showErrorMessage('EAS: The active quarter is locked. No submissions accepted.');
    return;
  }

  // Step 1: Task Description
  const taskDescription = await vscode.window.showInputBox({
    title: 'EAS Quick Log — Step 1/5',
    prompt: 'Describe what you accomplished using AI',
    placeHolder: 'e.g., Used GitHub Copilot to generate unit tests for the payment module...',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length < 10) {
        return 'Please provide at least 10 characters describing the task';
      }
      return null;
    },
  });
  if (taskDescription === undefined) return; // Cancelled

  // Step 2: AI Tool
  const aiToolItems: vscode.QuickPickItem[] = ctx.aiTools.map(t => ({
    label: t.value,
    description: t.isLicensed ? '⭐ Licensed' : '',
  }));

  const aiToolPick = await vscode.window.showQuickPick(aiToolItems, {
    title: 'EAS Quick Log — Step 2/5',
    placeHolder: 'Which AI tool did you use?',
    ignoreFocusOut: true,
  });
  if (!aiToolPick) return; // Cancelled

  // Step 3: Category
  const categoryItems: vscode.QuickPickItem[] = ctx.categories.map(c => ({ label: c }));

  const categoryPick = await vscode.window.showQuickPick(categoryItems, {
    title: 'EAS Quick Log — Step 3/5',
    placeHolder: 'Select the task category',
    ignoreFocusOut: true,
  });
  if (!categoryPick) return; // Cancelled

  // Step 4: Time Without AI
  const timeWithoutStr = await vscode.window.showInputBox({
    title: 'EAS Quick Log — Step 4/5',
    prompt: 'How many hours would this have taken WITHOUT AI?',
    placeHolder: 'e.g., 4',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const num = parseFloat(value);
      if (isNaN(num) || num < 0) {
        return 'Please enter a valid non-negative number';
      }
      return null;
    },
  });
  if (timeWithoutStr === undefined) return;

  // Step 5: Time With AI
  const timeWithStr = await vscode.window.showInputBox({
    title: 'EAS Quick Log — Step 5/5',
    prompt: `How many hours did it take WITH AI? (without AI: ${timeWithoutStr}h)`,
    placeHolder: 'e.g., 1.5',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const num = parseFloat(value);
      if (isNaN(num) || num < 0) {
        return 'Please enter a valid non-negative number';
      }
      if (num > parseFloat(timeWithoutStr)) {
        return 'Time with AI should not exceed time without AI';
      }
      return null;
    },
  });
  if (timeWithStr === undefined) return;

  // Optional: Quality Rating
  const qualityItems: vscode.QuickPickItem[] = [
    { label: '5', description: 'Excellent — AI output was production-ready' },
    { label: '4', description: 'Good — minor adjustments needed' },
    { label: '3', description: 'Average — moderate editing required' },
    { label: '2', description: 'Below average — significant rework needed' },
    { label: '1', description: 'Poor — minimal value from AI' },
    { label: 'Skip', description: 'Don\'t rate this task' },
  ];

  const qualityPick = await vscode.window.showQuickPick(qualityItems, {
    title: 'EAS Quick Log — Quality Rating (Optional)',
    placeHolder: 'Rate the quality of the AI output',
    ignoreFocusOut: true,
  });

  const qualityRating = qualityPick && qualityPick.label !== 'Skip'
    ? parseFloat(qualityPick.label)
    : undefined;

  // Auto-resolve project if there's a default or only one
  const config = vscode.workspace.getConfiguration('eas');
  const defaultProject = config.get<string>('defaultProject') || '';
  let project: string | undefined = defaultProject || undefined;
  let projectCode: string | undefined;

  if (!project && ctx.projects.length === 1) {
    project = ctx.projects[0].name;
    projectCode = ctx.projects[0].code;
  } else if (!project && ctx.projects.length > 1) {
    // Offer project selection
    const projectItems: vscode.QuickPickItem[] = [
      { label: 'None', description: 'No project' },
      ...ctx.projects.map(p => ({
        label: p.name,
        description: p.code ? `(${p.code})` : '',
        detail: p.customer || '',
      })),
    ];

    const projectPick = await vscode.window.showQuickPick(projectItems, {
      title: 'EAS Quick Log — Project (Optional)',
      placeHolder: 'Associate with a project?',
      ignoreFocusOut: true,
    });

    if (projectPick && projectPick.label !== 'None') {
      project = projectPick.label;
      const found = ctx.projects.find(p => p.name === project);
      projectCode = found?.code;
    }
  }

  // Calculate preview
  const timeWithout = parseFloat(timeWithoutStr);
  const timeWith = parseFloat(timeWithStr);
  const timeSaved = timeWithout - timeWith;

  // Confirmation
  const confirm = await vscode.window.showInformationMessage(
    `Submit task? Tool: ${aiToolPick.label} | Saved: ${timeSaved.toFixed(1)}h | Category: ${categoryPick.label}`,
    { modal: true },
    'Submit'
  );

  if (confirm !== 'Submit') return;

  // Submit
  try {
    const result = await submitTask({
      taskDescription: taskDescription.trim(),
      category: categoryPick.label,
      aiTool: aiToolPick.label,
      timeWithoutAi: timeWithout,
      timeWithAi: timeWith,
      qualityRating,
      project,
      projectCode,
    });

    if (result.success) {
      const approvalStatus = result.approval?.status || 'pending';
      const aiScore = result.approval?.aiValidation?.score;
      const scoreText = aiScore !== undefined ? ` | AI Score: ${aiScore}/100` : '';

      vscode.window.showInformationMessage(
        `✅ Task logged! Saved ${timeSaved.toFixed(1)}h. Approval: ${approvalStatus}${scoreText}`
      );
    }
  } catch (err) {
    vscode.window.showErrorMessage(`EAS: Failed to submit task — ${(err as Error).message}`);
  }
}
