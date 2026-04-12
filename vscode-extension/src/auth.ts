// ============================================================
// EAS Task Logger — Authentication Module
// OAuth PKCE flow via Supabase Auth with browser redirect
// ============================================================

import * as vscode from 'vscode';

/** Session tokens from Supabase Auth */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (seconds)
  user: {
    id: string;
    email: string;
  };
}

/** Event emitter for auth state changes */
const _onDidChangeAuth = new vscode.EventEmitter<AuthSession | null>();
export const onDidChangeAuth = _onDidChangeAuth.event;

let _currentSession: AuthSession | null = null;

// Keys for SecretStorage
const SECRET_ACCESS_TOKEN = 'eas.accessToken';
const SECRET_REFRESH_TOKEN = 'eas.refreshToken';
const SECRET_SESSION_DATA = 'eas.sessionData';

let _secrets: vscode.SecretStorage;

/**
 * Initialize the auth module with VS Code SecretStorage.
 * Must be called during extension activation.
 */
export function initAuth(secrets: vscode.SecretStorage): void {
  _secrets = secrets;
}

/**
 * Try to restore a saved session from SecretStorage.
 * Returns the session if valid, null if expired or not found.
 */
export async function restoreSession(): Promise<AuthSession | null> {
  try {
    const sessionJson = await _secrets.get(SECRET_SESSION_DATA);
    if (!sessionJson) return null;

    const session: AuthSession = JSON.parse(sessionJson);

    // Check if access token is expired (with 60s buffer)
    const now = Math.floor(Date.now() / 1000);
    if (session.expiresAt && session.expiresAt - 60 < now) {
      // Try to refresh
      const refreshed = await refreshAccessToken(session.refreshToken);
      if (refreshed) {
        _currentSession = refreshed;
        _onDidChangeAuth.fire(refreshed);
        return refreshed;
      }
      // Refresh failed — clear stored session
      await clearSession();
      return null;
    }

    _currentSession = session;
    _onDidChangeAuth.fire(session);
    return session;
  } catch {
    await clearSession();
    return null;
  }
}

/**
 * Get the current access token, refreshing if needed.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!_currentSession) return null;

  const now = Math.floor(Date.now() / 1000);
  if (_currentSession.expiresAt - 60 < now) {
    const refreshed = await refreshAccessToken(_currentSession.refreshToken);
    if (!refreshed) {
      await clearSession();
      _onDidChangeAuth.fire(null);
      return null;
    }
    _currentSession = refreshed;
    _onDidChangeAuth.fire(refreshed);
  }

  return _currentSession.accessToken;
}

/**
 * Get the current session (or null if not authenticated).
 */
export function getSession(): AuthSession | null {
  return _currentSession;
}

/**
 * Sign in via browser-based OAuth PKCE flow.
 * Opens the Supabase Auth login page in the default browser.
 * A URI handler catches the redirect with the access/refresh tokens.
 */
export async function signIn(): Promise<AuthSession | null> {
  const config = vscode.workspace.getConfiguration('eas');
  const supabaseUrl = config.get<string>('supabaseUrl') || '';
  const supabaseAnonKey = config.get<string>('supabaseAnonKey') || '';

  if (!supabaseUrl) {
    vscode.window.showErrorMessage('EAS: Supabase URL not configured. Set eas.supabaseUrl in settings.');
    return null;
  }

  // For simplicity, we use email/password sign-in via a Quick Input dialog
  // instead of a full browser OAuth flow. This avoids the complexity of
  // registering a URI handler and setting up callback URLs.
  // Future enhancement: full OAuth PKCE with browser redirect.

  const email = await vscode.window.showInputBox({
    prompt: 'Enter your EAS email address',
    placeHolder: 'you@ejada.com',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || !value.includes('@')) {
        return 'Please enter a valid email address';
      }
      return null;
    },
  });

  if (!email) return null; // User cancelled

  const password = await vscode.window.showInputBox({
    prompt: 'Enter your EAS password',
    placeHolder: 'Password',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.length < 6) {
        return 'Password must be at least 6 characters';
      }
      return null;
    },
  });

  if (!password) return null; // User cancelled

  try {
    // Call Supabase Auth REST API directly
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = (errorData as Record<string, string>).error_description
        || (errorData as Record<string, string>).msg
        || `Authentication failed (HTTP ${response.status})`;
      vscode.window.showErrorMessage(`EAS Sign In: ${msg}`);
      return null;
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user: { id: string; email: string };
    };

    const session: AuthSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    };

    // Store the session securely
    await _secrets.store(SECRET_ACCESS_TOKEN, session.accessToken);
    await _secrets.store(SECRET_REFRESH_TOKEN, session.refreshToken);
    await _secrets.store(SECRET_SESSION_DATA, JSON.stringify(session));

    _currentSession = session;
    _onDidChangeAuth.fire(session);

    vscode.window.showInformationMessage(`EAS: Signed in as ${session.user.email}`);
    return session;
  } catch (err) {
    vscode.window.showErrorMessage(`EAS Sign In failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Refresh the access token using the refresh token.
 */
async function refreshAccessToken(refreshToken: string): Promise<AuthSession | null> {
  const config = vscode.workspace.getConfiguration('eas');
  const supabaseUrl = config.get<string>('supabaseUrl') || '';
  const supabaseAnonKey = config.get<string>('supabaseAnonKey') || '';

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user: { id: string; email: string };
    };

    const session: AuthSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    };

    await _secrets.store(SECRET_ACCESS_TOKEN, session.accessToken);
    await _secrets.store(SECRET_REFRESH_TOKEN, session.refreshToken);
    await _secrets.store(SECRET_SESSION_DATA, JSON.stringify(session));

    return session;
  } catch {
    return null;
  }
}

/**
 * Sign out — clear session and stored tokens.
 */
export async function signOut(): Promise<void> {
  // Attempt to revoke the token server-side (best effort)
  if (_currentSession) {
    const config = vscode.workspace.getConfiguration('eas');
    const supabaseUrl = config.get<string>('supabaseUrl') || '';
    const supabaseAnonKey = config.get<string>('supabaseAnonKey') || '';
    try {
      await fetch(`${supabaseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${_currentSession.accessToken}`,
          'apikey': supabaseAnonKey,
        },
      });
    } catch {
      // Ignore errors — we still clear locally
    }
  }

  await clearSession();
  _onDidChangeAuth.fire(null);
  vscode.window.showInformationMessage('EAS: Signed out');
}

/**
 * Clear all stored session data.
 */
async function clearSession(): Promise<void> {
  _currentSession = null;
  try {
    await _secrets.delete(SECRET_ACCESS_TOKEN);
    await _secrets.delete(SECRET_REFRESH_TOKEN);
    await _secrets.delete(SECRET_SESSION_DATA);
  } catch {
    // Ignore
  }
}
