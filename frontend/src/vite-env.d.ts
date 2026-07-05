/// <reference types="vite/client" />

/**
 * Typed environment variables exposed to the browser by Vite.
 * All values must be prefixed with VITE_ and set in .env.local before
 * running the dev server or building for production.
 */
interface ImportMetaEnv {
  /** Base URL of the FastAPI backend (e.g. https://xxxx.execute-api.us-east-1.amazonaws.com/prod) */
  readonly VITE_API_BASE_URL: string;
  /** AWS region where the Cognito User Pool is hosted (e.g. us-east-1) */
  readonly VITE_COGNITO_REGION: string;
  /** Cognito App Client ID — public identifier, safe to ship in browser code */
  readonly VITE_COGNITO_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
