/**
 * Login.tsx
 *
 * Controlled sign-in form. Collects email and password, then delegates
 * the Cognito auth call to the parent via onSubmit. All network/error
 * handling lives in the parent (LoginPage) so this component stays pure UI.
 */

import { useState } from 'react';

interface LoginProps {
  /** Called with the form values when the user submits. Should throw on failure. */
  onSubmit: (payload: { email: string; password: string }) => Promise<void>;
}

/** Email + password form for signing in to an existing EcoLens account. */
export default function Login({ onSubmit }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setIsLoading(true);
        try {
          await onSubmit({ email, password });
        } finally {
          setIsLoading(false);
        }
      }}
    >
      <h2>Sign In to Your Account</h2>
      <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '0 0 20px' }}>
        Enter your credentials to access your wildlife library.
      </p>

      <label htmlFor="login-email">Email Address</label>
      <input
        id="login-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
        autoComplete="email"
      />

      <label htmlFor="login-password">Password</label>
      <input
        id="login-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Enter your password"
        required
        autoComplete="current-password"
      />

      <button className="btn" type="submit" disabled={isLoading}>
        {isLoading ? 'Signing in…' : 'Sign In'}
      </button>
    </form>
  );
}
