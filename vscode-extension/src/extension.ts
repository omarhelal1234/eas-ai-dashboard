// ============================================================
// EAS Task Logger — VS Code Extension Entry Point
// Phase 10: IDE Task Logger for EAS AI Adoption Dashboard
//
// Activation: sidebar view opened, or any eas.* command invoked
// ============================================================

import * as vscode from 'vscode';
import { initAuth, signIn, signOut, restoreSession, getSession } from './auth';
import { TaskLoggerViewProvider } from './sidebar';
import { quickLogTask } from './quickLog';
import { createStatusBarItem, disposeStatusBarItem } from './statusBar';
import { resetSessionTimer } from './contextDetector';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('EAS Task Logger: activating...');

  // Start session timer for time tracking
  resetSessionTimer();

  // Initialize auth with VS Code SecretStorage
  initAuth(context.secrets);

  // Set initial context for menu visibility
  vscode.commands.executeCommand('setContext', 'eas.isSignedIn', false);

  // Try to restore a previous session
  const restoredSession = await restoreSession();
  if (restoredSession) {
    vscode.commands.executeCommand('setContext', 'eas.isSignedIn', true);
    console.log(`EAS Task Logger: restored session for ${restoredSession.user.email}`);
  }

  // ---- Register Sidebar Webview Provider ----
  const sidebarProvider = new TaskLoggerViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TaskLoggerViewProvider.viewType,
      sidebarProvider
    )
  );

  // ---- Register Commands ----

  // Sign In
  context.subscriptions.push(
    vscode.commands.registerCommand('eas.signIn', async () => {
      const session = await signIn();
      if (session) {
        vscode.commands.executeCommand('setContext', 'eas.isSignedIn', true);
        sidebarProvider.refresh();
      }
    })
  );

  // Sign Out
  context.subscriptions.push(
    vscode.commands.registerCommand('eas.signOut', async () => {
      await signOut();
      vscode.commands.executeCommand('setContext', 'eas.isSignedIn', false);
      sidebarProvider.refresh();
    })
  );

  // Quick Log Task (Command Palette)
  context.subscriptions.push(
    vscode.commands.registerCommand('eas.quickLogTask', async () => {
      await quickLogTask();
      // Refresh sidebar after submission
      sidebarProvider.refresh();
    })
  );

  // Open Sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('eas.openSidebar', () => {
      // Focus the sidebar view
      vscode.commands.executeCommand('eas.taskLoggerView.focus');
    })
  );

  // Refresh Tasks
  context.subscriptions.push(
    vscode.commands.registerCommand('eas.refreshTasks', () => {
      sidebarProvider.refresh();
    })
  );

  // ---- Status Bar ----
  const statusBarItem = createStatusBarItem();
  context.subscriptions.push(statusBarItem);

  console.log('EAS Task Logger: activated successfully');
}

export function deactivate(): void {
  disposeStatusBarItem();
  console.log('EAS Task Logger: deactivated');
}
