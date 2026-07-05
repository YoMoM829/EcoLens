export default function HelpPage() {
  return (
    <main className="container">
      <div className="page-title">
        <h1>Help & API Documentation</h1>
        <p>Overview of EcoLens and complete reference for all backend REST API endpoints.</p>
      </div>

      {/* About */}
      <section className="card" style={{ marginBottom: '28px' }}>
        <h2>About EcoLens</h2>
        <p>
          EcoLens is a multi-cloud wildlife media platform. Users upload images and videos, an ML
          pipeline (MegaDetector + species classifier) automatically detects species and attaches
          tags, and the results are stored in OCI Oracle NoSQL for fast querying. Files are stored
          in Amazon S3; metadata (tags, URLs, ownership) lives in OCI NoSQL.
        </p>
        <p>
          The platform is <strong>shared-access</strong>: every authenticated user can search, view,
          and tag-edit all files regardless of who uploaded them. Only the original uploader may
          delete their own files. Species-watch notifications fire for all subscribers when a
          matching file is uploaded by any user.
        </p>
        <div className="help-feature-grid">
          <div className="help-feature-item">
            <span>📤</span>
            <div>
              <strong>Upload</strong>
              <p>Browser-side SHA-256 dedup check before upload. Files go directly to S3 via presigned URL — no size limit through the API.</p>
            </div>
          </div>
          <div className="help-feature-item">
            <span>🔍</span>
            <div>
              <strong>Query</strong>
              <p>Search by species name, minimum tag count, thumbnail URL, or by uploading a reference file for similarity matching.</p>
            </div>
          </div>
          <div className="help-feature-item">
            <span>🏷️</span>
            <div>
              <strong>Tag Management</strong>
              <p>Add or remove species tags across multiple files in one call. Any authenticated user may edit tags on any file.</p>
            </div>
          </div>
          <div className="help-feature-item">
            <span>🔔</span>
            <div>
              <strong>Notifications</strong>
              <p>Subscribe to SNS email alerts for specific species. Alerts fire whenever a matching file is uploaded by any user.</p>
            </div>
          </div>
        </div>
      </section>

      {/* RESTful design */}
      <section className="card" style={{ marginBottom: '28px' }}>
        <h2>RESTful API Design</h2>
        <p style={{ marginBottom: '16px' }}>
          The EcoLens backend is designed as a RESTful API. REST (Representational State Transfer)
          is an architectural style built on standard HTTP semantics. Here is how each principle
          applies:
        </p>
        <table className="api-params-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--border)' }}>Principle</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--border)' }}>How EcoLens applies it</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><strong>Resources as nouns</strong></td><td>URLs identify things, not actions. <code>/uploads</code> is a collection of upload intents; <code>/media</code> is the shared media pool; <code>/subscriptions</code> is the notification subscription resource.</td></tr>
            <tr><td><strong>HTTP verbs as actions</strong></td><td><code>GET</code> reads without side effects; <code>POST</code> creates or triggers; <code>DELETE</code> removes. No action verbs in the URL (no <code>/createUpload</code>, no <code>/deleteFile</code>).</td></tr>
            <tr><td><strong>Stateless</strong></td><td>Every request carries a Cognito JWT bearer token. The server holds no session state — each call is independently authenticated and authorised.</td></tr>
            <tr><td><strong>Uniform interface</strong></td><td>All endpoints use standard JSON request/response bodies and standard HTTP status codes (200 OK, 202 Accepted, 400 Bad Request, 401 Unauthorised, 404 Not Found, 502 Bad Gateway).</td></tr>
            <tr><td><strong>Consistent identifiers</strong></td><td>Every file is identified by its SHA-256 hex digest (<code>file_id</code>). This ID is embedded in every S3 key and URL the system produces, making resources addressable from any URL via <code>GET /media/{'{file_id}'}</code>.</td></tr>
          </tbody>
        </table>
      </section>

      {/* Authentication */}
      <section className="card" style={{ marginBottom: '28px' }}>
        <h2>Authentication</h2>
        <p>
          All endpoints (except <code>GET /health</code>) require a valid Cognito-issued ID token.
          Sign in through EcoLens to obtain one automatically. For direct API calls, attach it as:
        </p>
        <pre className="api-example-block" style={{ marginTop: '12px' }}>
          {`Authorization: Bearer <idToken>`}
        </pre>
        <p style={{ marginTop: '12px', color: 'var(--muted)', fontSize: '13px' }}>
          Tokens are short-lived. The frontend refreshes them transparently via Cognito. If you
          receive <code>401 Unauthorized</code>, sign out and sign in again.
        </p>
      </section>

      {/* API Reference */}
      <section className="card">
        <h2 style={{ marginBottom: '8px' }}>API Reference</h2>
        <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '28px' }}>
          Base URL: your API Gateway invoke URL, e.g. <code>https://&lt;id&gt;.execute-api.ap-southeast-4.amazonaws.com</code>
        </p>

        {/* ── Upload ── */}
        <SectionHeading>Upload</SectionHeading>

        <ApiEndpoint
          method="POST"
          path="/uploads"
          summary="Check for duplicates and obtain a presigned S3 PUT URL"
          description={
            <>
              The browser computes a SHA-256 digest of the file and sends it here before uploading.
              The backend performs a two-layer dedup check: first against the OCI NoSQL database
              (file already fully processed), then an S3 <code>head_object</code> (file uploaded
              but ML pipeline still running). If either layer finds a match,{' '}
              <code>duplicate: true</code> is returned with the existing URL — no upload needed.
              <br /><br />
              For new files the response includes a short-lived presigned S3 PUT URL. The browser
              must PUT the raw file bytes directly to that URL (not through the API) and must
              include the <code>x-amz-meta-user-id</code> header returned in{' '}
              <code>upload_headers</code> — this header is part of the S3 request signature and
              will be rejected if omitted. The S3 <code>ObjectCreated</code> event then triggers
              the ML Lambda automatically.
            </>
          }
          requestBody={{
            filename: 'string — original filename; used to derive the S3 key extension',
            checksum: 'string — SHA-256 hex digest of the file, computed in the browser',
            content_type: 'string — MIME type, e.g. "image/jpeg" or "video/mp4"',
          }}
          responseBody={{
            duplicate: 'boolean — true if the file already exists in the system',
            file_url: 'string — canonical plain URL of the file (existing or new)',
            'upload_url?': 'string — presigned S3 PUT URL; present only when duplicate is false',
            'upload_headers?': 'object — headers to include in the S3 PUT; contains x-amz-meta-user-id',
          }}
          example={{
            request: `POST /uploads
Content-Type: application/json
Authorization: Bearer <idToken>

{
  "filename": "wildlife_koala.jpg",
  "checksum": "a3f1c2d4e5b6...",
  "content_type": "image/jpeg"
}`,
            response: `// New file — upload_url is provided
{
  "duplicate": false,
  "file_url": "https://s3.ap-southeast-4.amazonaws.com/ecolens-uploads/uploads/a3f1c2d4e5b6....jpg",
  "upload_url": "https://ecolens-uploads.s3.ap-southeast-4.amazonaws.com/uploads/a3f1c2...?X-Amz-...",
  "upload_headers": { "x-amz-meta-user-id": "us-east-1:abc-123" }
}

// Duplicate — no upload needed
{
  "duplicate": true,
  "file_url": "https://s3.ap-southeast-4.amazonaws.com/ecolens-uploads/uploads/a3f1c2d4e5b6....jpg"
}`,
          }}
          notes="Allowed file types: .jpg .jpeg .png .bmp .webp .mp4 .mov .avi .mkv. The presigned URL expires in 1 hour."
        />

        {/* ── Media search ── */}
        <SectionHeading>Media</SectionHeading>

        <ApiEndpoint
          method="GET"
          path="/media"
          summary="Search the media pool by species tags"
          description={
            <>
              Returns all files in the shared media pool that match the given species filters. Two
              filter styles can be combined in one request:
              <ul style={{ margin: '8px 0 0 20px', lineHeight: 1.8 }}>
                <li><code>tag=species:minCount</code> — file must have at least <em>minCount</em> detections of that species.</li>
                <li><code>species=name</code> — shorthand for <code>tag=name:1</code>.</li>
              </ul>
              All filters are ANDed — a file must satisfy every condition to appear in the results.
              For image files the returned <code>url</code> is the thumbnail; for videos it is the
              full-size URL (no thumbnail is generated for videos).
            </>
          }
          queryParams={{
            'tag (repeatable)': '"species:minCount" — e.g. tag=koala:2&tag=dingo:1 requires ≥2 koalas AND ≥1 dingo',
            'species (repeatable)': 'species name implying count ≥ 1 — e.g. species=koala&species=wombat',
          }}
          responseBody={{
            count: 'number — total number of matching files',
            items: 'MediaResultItem[] — preferred result list (see below)',
            urls: 'string[] — thumbnail/video URLs (backwards-compat alias for items[].url)',
          }}
          example={{
            request: `GET /media?tag=koala:2&tag=dingo:1
Authorization: Bearer <idToken>`,
            response: `{
  "count": 2,
  "items": [
    {
      "url": "https://s3.../thumbnails/abc123.jpg",
      "original_url": "https://s3.../uploads/abc123.jpg",
      "file_type": "image",
      "tags": { "koala": 3, "dingo": 1 }
    },
    {
      "url": "https://s3.../thumbnails/def456.jpg",
      "original_url": "https://s3.../uploads/def456.jpg",
      "file_type": "image",
      "tags": { "koala": 2, "dingo": 2, "wombat": 1 }
    }
  ],
  "urls": [
    "https://s3.../thumbnails/abc123.jpg",
    "https://s3.../thumbnails/def456.jpg"
  ]
}`,
          }}
          notes="At least one tag or species parameter must be provided, otherwise the request is rejected with 400."
        />

        <ApiEndpoint
          method="GET"
          path="/media/{file_id}"
          summary="Resolve a file_id to its full-size URL and tags"
          description={
            <>
              Every URL produced by EcoLens encodes the file's SHA-256 digest as the filename stem.
              Extract the <code>file_id</code> by taking the last path segment of any system URL
              and dropping the extension. This endpoint returns the presigned full-size original
              URL and the file's detected species tags.
            </>
          }
          pathParams={{
            file_id: 'string — SHA-256 hex digest embedded in any system URL (thumbnail or original)',
          }}
          responseBody={{
            file_url: 'string — presigned GET URL for the full-size original file',
            tags: 'object — species → detection count map, e.g. { "koala": 3, "dingo": 1 }',
          }}
          example={{
            request: `// Extract file_id from any system URL:
// "https://s3.../thumbnails/abc123def456.jpg" → file_id = "abc123def456"

GET /media/abc123def456
Authorization: Bearer <idToken>`,
            response: `{
  "file_url": "https://ecolens-uploads.s3.ap-southeast-4.amazonaws.com/uploads/abc123def456.jpg?X-Amz-...",
  "tags": { "koala": 3, "dingo": 1 }
}`,
          }}
          notes="The returned file_url is a short-lived presigned S3 GET URL — valid for 1 hour. Do not persist it; generate a fresh one when needed."
        />

        <ApiEndpoint
          method="POST"
          path="/media/similar/presign"
          summary="Step 1 of find-similar: get a presigned URL for a reference file"
          description={
            <>
              The find-similar-by-file flow uses two steps to work around API Gateway's 6 MB body
              limit. This step returns a presigned S3 PUT URL pointing to a temporary query bucket
              (not the user uploads bucket). The browser PUTs the reference file bytes directly to
              that URL. The temp file is deleted automatically after ML inference and is never
              stored in the database.
              <br /><br />
              <strong>Dedup optimisation:</strong> the frontend computes the file's SHA-256 before
              calling this endpoint and checks <code>POST /uploads</code> first. If the file is
              already in the database this step is skipped entirely and the stored tags are used
              directly for similarity search.
            </>
          }
          requestBody={{
            filename: 'string (form field) — original filename; used to derive the temp S3 key extension',
            content_type: 'string (form field) — MIME type of the reference file',
          }}
          responseBody={{
            upload_url: 'string — presigned S3 PUT URL for the query-temp bucket (expires in 5 min)',
            s3_key: 'string — UUID-based key to pass to POST /media/similar in the next step',
          }}
          example={{
            request: `POST /media/similar/presign
Content-Type: multipart/form-data
Authorization: Bearer <idToken>

filename=query_photo.jpg
content_type=image/jpeg`,
            response: `{
  "upload_url": "https://ecolens-query-temp.s3.ap-southeast-4.amazonaws.com/7f3a...jpg?X-Amz-...",
  "s3_key": "7f3a9c1e-4b82-4d6a-9f1c-2e8a7b3d5f6e.jpg"
}`,
          }}
          notes="Send as multipart/form-data, not JSON. The presigned URL expires in 5 minutes."
        />

        <ApiEndpoint
          method="POST"
          path="/media/similar"
          summary="Step 2 of find-similar: run ML inference and return matching files"
          description={
            <>
              After uploading the reference file to S3 (using the URL from{' '}
              <code>POST /media/similar/presign</code>), call this endpoint with the returned{' '}
              <code>s3_key</code>. The backend invokes the ML Lambda to detect species in the
              reference file, then queries the database for all stored files containing the same
              species (count ≥ 1 each).
              <br /><br />
              <strong>Images (synchronous):</strong> the ML Lambda is invoked with{' '}
              <code>RequestResponse</code> — the API waits for inference to complete (up to 29 s)
              and returns a <code>200 QueryResult</code> immediately.
              <br /><br />
              <strong>Videos (asynchronous):</strong> to bypass API Gateway's 29-second timeout,
              the ML Lambda is invoked with <code>Event</code> (fire-and-forget). The endpoint
              returns <code>202 Accepted</code> with a <code>job_id</code> immediately. The caller
              must poll <code>GET /media/similar/result/{'{job_id}'}</code> every few seconds until
              the result is ready. The temp video file is deleted by the ML Lambda when it finishes.
            </>
          }
          requestBody={{
            s3_key: 'string (form field) — the s3_key returned by POST /media/similar/presign',
          }}
          responseBody={{
            '200 — image result': 'QueryResult: { count, items, urls }',
            '202 — video accepted': '{ job_id: string, status: "processing" }',
          }}
          example={{
            request: `POST /media/similar
Content-Type: multipart/form-data
Authorization: Bearer <idToken>

s3_key=7f3a9c1e-4b82-4d6a-9f1c-2e8a7b3d5f6e.jpg`,
            response: `// Image — 200 OK (synchronous result)
{
  "count": 3,
  "items": [
    { "url": "https://s3.../thumbnails/abc123.jpg", "original_url": "...", "file_type": "image", "tags": { "koala": 2 } },
    { "url": "https://s3.../thumbnails/def456.jpg", "original_url": "...", "file_type": "image", "tags": { "koala": 1 } },
    { "url": "https://s3.../uploads/vid789.mp4",   "original_url": "...", "file_type": "video", "tags": { "koala": 4 } }
  ],
  "urls": ["https://s3.../thumbnails/abc123.jpg", "..."]
}

// Video — 202 Accepted (poll for result)
{
  "job_id": "7f3a9c1e-4b82-4d6a-9f1c-2e8a7b3d5f6e",
  "status": "processing"
}`,
          }}
          notes="The temp reference file is deleted from S3 immediately after inference (images) or by the ML Lambda on completion (videos)."
        />

        <ApiEndpoint
          method="GET"
          path="/media/similar/result/{job_id}"
          summary="Poll for the result of an async video similarity search"
          description={
            <>
              Used only for video reference files submitted to{' '}
              <code>POST /media/similar</code>. Poll this endpoint every few seconds after
              receiving a <code>202</code>. Returns <code>202</code> while the ML Lambda is still
              running, or <code>200 QueryResult</code> when the result is ready. The result JSON
              is deleted from S3 as soon as it is read.
            </>
          }
          pathParams={{
            job_id: 'string — the job_id returned in the 202 response from POST /media/similar',
          }}
          responseBody={{
            '202 — still processing': '{ status: "processing" }',
            '200 — done': 'QueryResult: { count, items, urls }',
            '502 — error': '{ detail: string } — ML Lambda reported a processing failure',
          }}
          example={{
            request: `GET /media/similar/result/7f3a9c1e-4b82-4d6a-9f1c-2e8a7b3d5f6e
Authorization: Bearer <idToken>`,
            response: `// Still running — poll again in a few seconds
HTTP 202
{ "status": "processing" }

// Done
HTTP 200
{
  "count": 2,
  "items": [ { "url": "...", "original_url": "...", "file_type": "image", "tags": { "wombat": 1 } } ],
  "urls": ["..."]
}`,
          }}
          notes="The frontend polls every 3 seconds with a 5-minute timeout. If the job never completes within 5 minutes, the frontend shows a timeout error."
        />

        <ApiEndpoint
          method="POST"
          path="/media/tags"
          summary="Bulk add or remove tags across multiple files"
          description={
            <>
              Adds or removes species tags across multiple files in a single request. Any
              authenticated user may edit tags on any file (shared-access platform).
              <ul style={{ margin: '8px 0 0 20px', lineHeight: 1.8 }}>
                <li><code>operation = 1</code> (add): each tag is added with count 1 if not already present; existing counts are preserved.</li>
                <li><code>operation = 0</code> (remove): each tag is removed from the file; tags not present on a file are silently skipped.</li>
              </ul>
            </>
          }
          requestBody={{
            urls: 'string[] — file URLs to modify (any URL previously returned by the system)',
            tags: 'string[] — species tag names to add or remove',
            operation: 'number — 1 = add tags, 0 = remove tags',
          }}
          responseBody={{
            updated: 'number — count of files that were processed (found in DB)',
            not_found: 'string[] — URLs that had no matching database record',
          }}
          example={{
            request: `POST /media/tags
Content-Type: application/json
Authorization: Bearer <idToken>

{
  "urls": [
    "https://s3.../thumbnails/abc123.jpg",
    "https://s3.../uploads/def456.mp4"
  ],
  "tags": ["koala", "wombat"],
  "operation": 1
}`,
            response: `{
  "updated": 2,
  "not_found": []
}`,
          }}
          notes="Pass any URL produced by the system — thumbnail URL, original URL, or presigned URL. The file_id is extracted from the URL path automatically."
        />

        <ApiEndpoint
          method="DELETE"
          path="/media"
          summary="Delete files, thumbnails, detection JSON, and database records"
          description={
            <>
              Permanently removes the original file, its thumbnail (images only), and the ML
              detection JSON from S3, then deletes the OCI NoSQL record.{' '}
              <strong>Only the user who originally uploaded a file may delete it</strong> — attempts
              by other users return a <code>forbidden</code> list rather than an error, so a bulk
              request can partially succeed.
            </>
          }
          requestBody={{
            urls: 'string[] — file URLs to delete (original or thumbnail URL)',
          }}
          responseBody={{
            deleted: 'number — count of files successfully deleted',
            not_found: 'string[] — URLs with no matching database record',
            forbidden: 'string[] — URLs owned by a different user',
          }}
          example={{
            request: `DELETE /media
Content-Type: application/json
Authorization: Bearer <idToken>

{
  "urls": [
    "https://s3.../uploads/abc123.jpg",
    "https://s3.../uploads/xyz999.jpg"
  ]
}`,
            response: `// abc123 deleted, xyz999 owned by someone else
{
  "deleted": 1,
  "not_found": [],
  "forbidden": ["https://s3.../uploads/xyz999.jpg"]
}`,
          }}
          notes="This operation is irreversible. All three S3 objects (original, thumbnail, detections) are deleted along with the database record."
        />

        {/* ── Subscriptions ── */}
        <SectionHeading>Subscriptions</SectionHeading>

        <ApiEndpoint
          method="GET"
          path="/subscriptions"
          summary="Get the current user's species-watch subscription"
          description="Returns the active SNS subscription for the authenticated user's account email, including the species being watched and the subscription status. Returns null (JSON null) if the user has no active subscription."
          responseBody={{
            subscription_arn: 'string — AWS SNS subscription ARN',
            species: 'string[] — list of species being watched',
            status: '"confirmed" — subscription is active and receiving alerts',
          }}
          example={{
            request: `GET /subscriptions
Authorization: Bearer <idToken>`,
            response: `// Active subscription
{
  "subscription_arn": "arn:aws:sns:ap-southeast-4:390132056642:ecolens-tags:abc-123",
  "species": ["koala", "wombat"],
  "status": "confirmed"
}

// No subscription
null`,
          }}
        />

        <ApiEndpoint
          method="POST"
          path="/subscriptions"
          summary="Subscribe to (or update) species-watch email alerts"
          description={
            <>
              Creates an SNS email subscription for the authenticated user's Cognito account email.
              If a confirmed subscription already exists with different species, the filter policy
              is updated in-place — no new confirmation email is sent.
              <br /><br />
              For a brand-new subscription, AWS SNS sends a confirmation email. Alerts will not
              fire until the user clicks the confirmation link.
            </>
          }
          requestBody={{
            species: 'string[] — species names to watch, e.g. ["koala", "wombat", "dingo"]',
          }}
          responseBody={{
            subscription_arn: 'string — AWS SNS subscription ARN (may be "PendingConfirmation" for new subscriptions)',
            pending_confirmation: 'boolean — true when a confirmation email has been sent and not yet clicked',
          }}
          example={{
            request: `POST /subscriptions
Content-Type: application/json
Authorization: Bearer <idToken>

{
  "species": ["koala", "wombat"]
}`,
            response: `// New subscription — check email for confirmation link
{
  "subscription_arn": "arn:aws:sns:ap-southeast-4:390132056642:ecolens-tags:abc-123",
  "pending_confirmation": true
}`,
          }}
          notes="The email address used is always the authenticated user's Cognito account email — there is no email override."
        />

        <ApiEndpoint
          method="DELETE"
          path="/subscriptions"
          summary="Cancel the current user's species-watch subscription"
          description="Unsubscribes the authenticated user's account email from the SNS topic. Returns 404 if no active subscription exists."
          responseBody={{
            cancelled: 'boolean — always true when the response is 200',
          }}
          example={{
            request: `DELETE /subscriptions
Authorization: Bearer <idToken>`,
            response: `{ "cancelled": true }`,
          }}
          isLast
        />
      </section>
    </main>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--muted)',
      margin: '28px 0 16px', paddingBottom: '8px',
      borderBottom: '1px solid var(--border)',
    }}>
      {children}
    </h3>
  );
}

// ── ApiEndpoint ───────────────────────────────────────────────────────────────

interface ApiEndpointProps {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT';
  path: string;
  summary: string;
  description: React.ReactNode;
  requestBody?: Record<string, string>;
  queryParams?: Record<string, string>;
  pathParams?: Record<string, string>;
  responseBody?: Record<string, string>;
  example?: { request?: string; response: string };
  notes?: string;
  isLast?: boolean;
}

function ApiEndpoint({
  method, path, summary, description,
  requestBody, queryParams, pathParams, responseBody,
  example, notes, isLast,
}: ApiEndpointProps) {
  const methodColors: Record<string, string> = {
    GET: '#0e7a5b',
    POST: '#1a56db',
    DELETE: '#b42318',
    PUT: '#b45309',
  };

  return (
    <div className={`api-endpoint${isLast ? '' : ' api-endpoint-border'}`}>
      <div className="api-endpoint-header">
        <span className="api-method" style={{ background: methodColors[method] ?? '#333' }}>
          {method}
        </span>
        <code className="api-path">{path}</code>
      </div>
      <p className="api-summary">{summary}</p>
      <div className="api-description">{description}</div>

      {pathParams && <ParamTable title="Path Parameters" params={pathParams} />}
      {queryParams && <ParamTable title="Query Parameters" params={queryParams} />}
      {requestBody && <ParamTable title="Request Body" params={requestBody} />}
      {responseBody && <ParamTable title="Response Body" params={responseBody} />}

      {example && (
        <div style={{ marginTop: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {example.request && (
            <div style={{ flex: '1 1 300px' }}>
              <p className="api-params-title">Example Request</p>
              <pre className="api-example-block">{example.request}</pre>
            </div>
          )}
          <div style={{ flex: '1 1 300px' }}>
            <p className="api-params-title">Example Response</p>
            <pre className="api-example-block">{example.response}</pre>
          </div>
        </div>
      )}

      {notes && (
        <div className="api-notes" style={{ marginTop: '12px' }}>
          <strong>Note:</strong> {notes}
        </div>
      )}
    </div>
  );
}

// ── ParamTable ────────────────────────────────────────────────────────────────

function ParamTable({ title, params }: { title: string; params: Record<string, string> }) {
  return (
    <div className="api-params">
      <p className="api-params-title">{title}</p>
      <table className="api-params-table">
        <tbody>
          {Object.entries(params).map(([k, v]) => (
            <tr key={k}>
              <td><code>{k}</code></td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
