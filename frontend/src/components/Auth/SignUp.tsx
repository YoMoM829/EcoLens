/**
 * SignUp.tsx
 *
 * Registration form collecting email, first name, last name, and password.
 * Client-side validation runs before the Cognito call to surface obvious
 * errors (empty fields, password length, mismatched confirm) without a
 * round-trip. Cognito's own policy (uppercase, digit, symbol requirements)
 * may add additional errors that surface via the parent's error handler.
 */

import { useState } from 'react';

interface SignUpPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

interface SignUpProps {
  /** Called with the validated form values. Should throw on Cognito failure. */
  onSubmit: (payload: SignUpPayload) => Promise<void>;
}

/** Account creation form for new EcoLens users. */
export default function SignUp({ onSubmit }: SignUpProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const passwordsMatch = password === confirmPassword;
  const passwordFilled = password.length > 0;

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError('');

        if (!firstName.trim() || !lastName.trim() || !email.trim()) {
          setError('All fields are required.');
          return;
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters.');
          return;
        }
        if (!passwordsMatch) {
          setError('Passwords do not match.');
          return;
        }

        setIsLoading(true);
        try {
          await onSubmit({ email, password, firstName, lastName });
        } finally {
          setIsLoading(false);
        }
      }}
    >
      <h2>Account Information</h2>
      <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '0 0 20px' }}>
        Enter your details to create an EcoLens account.
      </p>

      <label htmlFor="signup-first-name">First Name</label>
      <input
        id="signup-first-name"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        placeholder="e.g. Jane"
        required
        autoComplete="given-name"
      />

      <label htmlFor="signup-last-name">Last Name</label>
      <input
        id="signup-last-name"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
        placeholder="e.g. Smith"
        required
        autoComplete="family-name"
      />

      <label htmlFor="signup-email">Email Address</label>
      <input
        id="signup-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
        autoComplete="email"
      />

      <label htmlFor="signup-password">Password</label>
      <input
        id="signup-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Min. 8 characters"
        required
        autoComplete="new-password"
      />

      <label htmlFor="signup-confirm-password">
        Confirm Password
        {passwordFilled && passwordsMatch && (
          <span style={{ color: 'var(--primary)', marginLeft: '8px' }}>✓</span>
        )}
        {passwordFilled && !passwordsMatch && (
          <span style={{ color: 'var(--danger)', marginLeft: '8px' }}>✗</span>
        )}
      </label>
      <input
        id="signup-confirm-password"
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="Re-enter your password"
        required
        autoComplete="new-password"
      />

      {error && (
        <p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '12px' }}>
          ⚠️ {error}
        </p>
      )}

      <button className="btn" type="submit" disabled={isLoading}>
        {isLoading ? 'Creating Account…' : 'Create Account'}
      </button>
    </form>
  );
}
