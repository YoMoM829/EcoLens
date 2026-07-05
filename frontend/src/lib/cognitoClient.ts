/**
 * cognitoClient.ts
 *
 * Direct Cognito API calls using the AWS SDK for JavaScript v3.
 * This runs entirely in the browser — no server round-trip needed for auth.
 * The Cognito App Client must have the USER_PASSWORD_AUTH flow enabled.
 *
 * Tokens are stored in sessionStorage (cleared on tab close) to avoid
 * persisting credentials in localStorage where XSS could reach them more easily.
 *
 * Token keys written:
 *   sessionStorage["accessToken"]  — short-lived access token
 *   sessionStorage["idToken"]      — JWT with user claims, sent as Bearer to the backend
 *   sessionStorage["refreshToken"] — used to renew the session (not yet wired)
 */

import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export interface AuthSession {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
}

interface SignUpPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

const region = import.meta.env.VITE_COGNITO_REGION;
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;

if (!region || !clientId) {
  console.warn(
    'Cognito is not fully configured — set VITE_COGNITO_REGION and VITE_COGNITO_CLIENT_ID in .env.local.',
  );
}

const cognitoClient = new CognitoIdentityProviderClient({ region });

/**
 * Sign in with email and password using the USER_PASSWORD_AUTH flow.
 *
 * On success, tokens are stored in sessionStorage so subsequent API calls
 * can attach the idToken as a Bearer token.
 *
 * @throws If Cognito rejects the credentials or the flow returns no access token.
 */
export async function signIn(email: string, password: string): Promise<AuthSession> {
  const command = new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });

  const { AuthenticationResult } = await cognitoClient.send(command);

  if (!AuthenticationResult?.AccessToken) {
    throw new Error('Sign-in succeeded but no access token was returned.');
  }

  sessionStorage.setItem('accessToken', AuthenticationResult.AccessToken);
  sessionStorage.setItem('idToken', AuthenticationResult.IdToken ?? '');
  sessionStorage.setItem('refreshToken', AuthenticationResult.RefreshToken ?? '');

  return {
    accessToken: AuthenticationResult.AccessToken,
    idToken: AuthenticationResult.IdToken,
    refreshToken: AuthenticationResult.RefreshToken,
    expiresIn: AuthenticationResult.ExpiresIn,
    tokenType: AuthenticationResult.TokenType,
  };
}

/**
 * Register a new account.
 *
 * Cognito sends a verification email with a one-time code. The user must
 * call confirmSignUp() with that code before they can sign in.
 * Required Cognito User Pool attributes: email, given_name, family_name.
 */
export async function signUp({ email, password, firstName, lastName }: SignUpPayload): Promise<void> {
  const command = new SignUpCommand({
    ClientId: clientId,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'given_name', Value: firstName },
      { Name: 'family_name', Value: lastName },
    ],
  });

  await cognitoClient.send(command);
}

/**
 * Confirm a new account with the verification code sent by Cognito via email.
 *
 * @param email            The email address used during sign-up.
 * @param confirmationCode The 6-digit code from the verification email.
 */
export async function confirmSignUp(email: string, confirmationCode: string): Promise<void> {
  const command = new ConfirmSignUpCommand({
    ClientId: clientId,
    Username: email,
    ConfirmationCode: confirmationCode,
  });

  await cognitoClient.send(command);
}

/**
 * Sign out by removing all auth tokens from sessionStorage.
 * Only the three keys written by signIn() are removed — other sessionStorage
 * entries are left untouched.
 */
export function signOut(): void {
  sessionStorage.removeItem('accessToken');
  sessionStorage.removeItem('idToken');
  sessionStorage.removeItem('refreshToken');
}
