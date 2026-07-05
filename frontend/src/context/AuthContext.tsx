/**
 * AuthContext.tsx
 *
 * React context that provides auth state and operations to the whole app.
 * Using context (rather than reading sessionStorage on each render) ensures
 * that sign-in and sign-out trigger immediate re-renders everywhere
 * isAuthenticated is consumed — no stale UI, no navigation hacks needed.
 *
 * Usage:
 *   1. Wrap your root with <AuthProvider>.
 *   2. Call useAuth() inside any child component to access the context value.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  confirmSignUp as cognitoConfirmSignUp,
  signIn as cognitoSignIn,
  signOut as cognitoSignOut,
  signUp as cognitoSignUp,
} from '../lib/cognitoClient';
import type { AuthSession } from '../lib/cognitoClient';

interface SignUpPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

interface AuthContextValue {
  /** True when a valid, non-expired idToken is held in sessionStorage. */
  isAuthenticated: boolean;
  /** Email address decoded from the idToken JWT payload, or null if not signed in. */
  userEmail: string | null;
  signIn: (email: string, password: string) => Promise<AuthSession>;
  signUp: (payload: SignUpPayload) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => void;
}

// ── JWT expiry helpers ───────────────────────────────────────────────────────

/** Extract the email claim from a JWT payload without a library. */
function getEmailFromJwt(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
    const payload = JSON.parse(atob(padded)) as { email?: unknown };
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

/** Extract the `exp` claim (Unix seconds) from a JWT without a library. */
function getJwtExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Return true if the token exists and has not expired. */
function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  const expiry = getJwtExpiry(token);
  return Boolean(expiry && expiry * 1000 > Date.now());
}

// ── Context + Provider ───────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Wrap the application root with AuthProvider so all child components can
 * call useAuth(). The provider initialises auth state from sessionStorage
 * once (on mount) and keeps it in sync as sign-in / sign-out happen.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() =>
    isTokenValid(sessionStorage.getItem('idToken')),
  );
  const [userEmail, setUserEmail] = useState<string | null>(() =>
    getEmailFromJwt(sessionStorage.getItem('idToken') ?? ''),
  );

  const signIn = useCallback(async (email: string, password: string): Promise<AuthSession> => {
    const session = await cognitoSignIn(email, password);
    setIsAuthenticated(true);
    setUserEmail(getEmailFromJwt(sessionStorage.getItem('idToken') ?? '') ?? email);
    return session;
  }, []);

  const signUp = useCallback(async (payload: SignUpPayload): Promise<void> => {
    await cognitoSignUp(payload);
  }, []);

  const confirmSignUp = useCallback(async (email: string, code: string): Promise<void> => {
    await cognitoConfirmSignUp(email, code);
  }, []);

  const signOut = useCallback((): void => {
    cognitoSignOut();
    setIsAuthenticated(false);
    setUserEmail(null);
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, userEmail, signIn, signUp, confirmSignUp, signOut }),
    [isAuthenticated, userEmail, signIn, signUp, confirmSignUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Access the auth context from any component inside AuthProvider.
 * Throws if called outside of an AuthProvider — catches wiring mistakes early.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
