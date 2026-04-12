// ============================================================
// EAS Task Logger — Status Bar Item
// Shows logged-in user and quick stats in the VS Code status bar
// ============================================================

import * as vscode from 'vscode';
import { getSession, onDidChangeAuth, AuthSession } from './auth';

let _statusBarItem: vscode.StatusBarItem;

/**
 * Create and register the status bar item.
 * Shows the user's name when signed in, or "EAS: Sign In" when not.
 */
export function createStatusBarItem(): vscode.StatusBarItem {
  _statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );

  _statusBarItem.command = 'eas.openSidebar';

  // Set initial state
  updateStatusBar(getSession());

  // Listen for auth changes
  onDidChangeAuth((session) => {
    updateStatusBar(session);
  });

  _statusBarItem.show();
  return _statusBarItem;
}

/**
 * Update the status bar text and tooltip based on auth state.
 */
function updateStatusBar(session: AuthSession | null): void {
  if (!_statusBarItem) return;

  if (session) {
    _statusBarItem.text = `$(tasklist) EAS: ${session.user.email.split('@')[0]}`;
    _statusBarItem.tooltip = `EAS Task Logger — Signed in as ${session.user.email}\nClick to open sidebar`;
    _statusBarItem.command = 'eas.openSidebar';
  } else {
    _statusBarItem.text = '$(sign-in) EAS: Sign In';
    _statusBarItem.tooltip = 'EAS Task Logger — Click to sign in';
    _statusBarItem.command = 'eas.signIn';
  }
}

/**
 * Update the status bar with task count info.
 */
export function updateTaskCount(count: number): void {
  if (!_statusBarItem) return;

  const session = getSession();
  if (session) {
    _statusBarItem.text = `$(tasklist) EAS: ${session.user.email.split('@')[0]} (${count})`;
  }
}

/**
 * Dispose the status bar item.
 */
export function disposeStatusBarItem(): void {
  _statusBarItem?.dispose();
}
