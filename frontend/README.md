# Aussie EcoLens frontend

This folder contains the React 18 + Vite single-page application for Aussie EcoLens. The UI provides:

- Cognito-based sign-up (with email verification), sign-in, sign-out, and reactive session handling.
- Media upload via presigned S3 URLs with SHA-256 duplicate detection.
- Tag-count search (logical AND) and species search from the query page.
- Thumbnail URL lookup to retrieve the corresponding full-size original image.
- Query by uploaded file — file is analysed by the ML pipeline and discarded, not stored.
- Thumbnail previews in a results grid with click-to-full-size modal.
- Bulk tag add/remove across multiple files, and file deletion.
- Email alert subscriptions via SNS for species/tag notifications.

## API base URL

The frontend talks to the backend via a configurable API base URL:

- In **production**, `VITE_API_BASE_URL` must point to the API Gateway base URL (for example, `https://xxxx.ap-southeast-4.amazonaws.com/prod`).
- In **local development**, you can use `http://localhost:8000` when the FastAPI backend is running via Uvicorn.

The app reads this value from `import.meta.env.VITE_API_BASE_URL`. All three environment variables are typed in `src/vite-env.d.ts` so TypeScript validates them at build time.

## Environment variables

Copy `.env.example` to `.env.local` and fill in the values before running:

```bash
cp .env.example .env.local
```

| Variable | Description | Example |
|---|---|---|
| `VITE_API_BASE_URL` | FastAPI backend base URL | `http://localhost:8000` (dev) or API Gateway URL (prod) |
| `VITE_COGNITO_REGION` | AWS region of the Cognito User Pool | `ap-southeast-2` |
| `VITE_COGNITO_CLIENT_ID` | Cognito App Client ID (public — safe to expose) | `3abc123…` |

## Cognito requirements

The Cognito User Pool App Client must have:
- **USER_PASSWORD_AUTH** flow enabled
- **Required attributes**: `email`, `given_name`, `family_name`
- Password policy minimum 8 characters (the frontend enforces this client-side)

## Local development

```bash
cd frontend
npm install
cp .env.example .env.local   # then edit .env.local with your values
npm run dev
```

Open the URL printed by Vite (default `http://localhost:5173`).

## Production build and deploy

```bash
cd frontend
npm run build   # runs tsc --noEmit then vite build; output in dist/
```

To publish the frontend to AWS S3 + CloudFront, use the deployment script from the project root:

```bash
# 1. Fill in frontend/.env.local with production values (API Gateway URL etc.)
# 2. Run the deploy script (builds, uploads to S3, applies cache headers)
./scripts/deploy_frontend.sh [aws-region] [project-prefix] [account-id]
```

If you deploy manually, sync the build output to the frontend S3 bucket:

```bash
aws s3 sync dist/ "s3://<frontend-bucket-name>/" --delete
```

Invalidate the CloudFront cache after each deployment so new assets are picked up immediately:

```bash
aws cloudfront create-invalidation --distribution-id <cloudfront-distribution-id> --paths "/*"
```

CloudFront must be configured with custom error responses that redirect 403 and 404 to `/index.html` with a 200 status — this is required for React Router's `BrowserRouter` to handle all routes correctly.

## Folder structure

```text
frontend/
├── .env.example              # Template — copy to .env.local and fill in values
├── index.html
├── package.json
├── tsconfig.json             # strict mode, noImplicitAny
├── vite.config.ts
└── src/
    ├── App.tsx               # BrowserRouter + AuthProvider + route definitions
    ├── main.tsx              # Entry point — mounts App into #root
    ├── index.css             # Global CSS variables, layout, component styles
    ├── vite-env.d.ts         # Typed ImportMetaEnv for all VITE_ variables
    ├── context/
    │   └── AuthContext.tsx   # React context + useAuth hook (reactive auth state)
    ├── lib/
    │   ├── apiClient.ts      # Axios wrapper for all backend API calls
    │   └── cognitoClient.ts  # Cognito authentication helpers
    ├── hooks/
    │   ├── useUpload.ts      # Presigned-URL upload flow with dedup feedback
    │   ├── useQuery.ts       # All four query modes + thumbnail→full-size resolution
    │   └── useNotifications.ts # SNS subscription state
    ├── components/
    │   ├── Auth/             # Sign-in, sign-up, sign-out flows
    │   ├── Upload/           # Media upload and presigned URL handling
    │   ├── Query/            # Search forms and query result display
    │   ├── Tags/             # Bulk tag editing and file deletion
    │   ├── Media/            # Thumbnail grid and full-size modal
    │   └── Notifications/    # Species alert subscription form
    └── pages/
        ├── LoginPage.tsx
        ├── SignUpPage.tsx        # Two-step: create account → verify email
        ├── DashboardPage.tsx     # Upload + bulk tag management
        ├── QueryPage.tsx         # All query modes + shared results grid
        └── NotificationsPage.tsx # Email alert subscription
```

## Notes

- Do not hardcode API URLs in components; always use `VITE_API_BASE_URL`.
- The Cognito `clientId` is intentionally public — it is only an identifier, not a secret.
- Auth tokens are stored in `sessionStorage` (cleared when the tab closes) rather than `localStorage` to limit XSS exposure.
- For the assignment demo, ensure the UI surfaces:
  - Clear auth flow (sign-up with email verification, sign-in, sign-out).
  - Upload success/failure and deduplication messages.
  - Query results with thumbnails and full-size modal.
  - Tag edit and delete operations.
  - SNS subscription confirmation flow.
