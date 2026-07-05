/**
 * apiClient.ts
 *
 * Thin HTTP wrapper around the EcoLens RESTful API backend.
 * Every function reads the Bearer token from sessionStorage and attaches it
 * as an Authorization header so all endpoints are protected by Cognito.
 *
 * RESTful endpoint map:
 *   POST   /uploads                              → requestPresign
 *   GET    /media?tag=koala:2&tag=wombat:1       → queryMediaByTags
 *   GET    /media?species=koala&species=dingo     → queryMediaBySpecies
 *   GET    /media/{file_id}                       → queryMediaByFileId
 *   POST   /media/similar                         → queryMediaByFile
 *   POST   /media/tags                            → bulkTagEdit
 *   DELETE /media                                 → deleteMedia
 *   GET    /subscriptions                         → getNotificationSubscription
 *   POST   /subscriptions                         → subscribeToNotifications
 *   DELETE /subscriptions                         → cancelNotificationSubscription
 */

import axios from 'axios';

// ── Shared types ────────────────────────────────────────────────────────────

/** {species: minCount} map for tag-count queries, e.g. { koala: 2, dingo: 1 } */
export type TagCountMap = Record<string, number>;

/** Backend PresignResponse schema */
export interface PresignResponse {
  duplicate: boolean;
  upload_headers?: Record<string, string>;
  file_url: string;
  upload_url?: string;
}

/** Single result item used across query hooks and MediaGrid */
export interface MediaItem {
  /** Stable key derived from index + URL */
  id: string;
  /** Thumbnail URL for images; full file URL for videos */
  url: string;
  /** Full-size original file URL (same as url for videos) */
  originalUrl: string;
  mediaType: 'image' | 'video';
  /** Detected species → count, e.g. { koala: 3, dingo: 1 } */
  tags: Record<string, number>;
}

// ── Internal request/response shapes ────────────────────────────────────────

interface QueryResultItem {
  url: string;                        // thumbnail URL (images) or full URL (videos)
  original_url: string;               // full-size original file URL
  file_type: string;                  // "image" | "video"
  tags: Record<string, number>;       // species → count
}

interface QueryResultResponse {
  urls: string[];           // backwards compat
  count: number;
  items: QueryResultItem[]; // preferred — use this for rendering
}

interface FullImageResponse {
  file_url: string;
  tags: Record<string, number>;
}

interface BulkTagEditRequest {
  urls: string[];
  tags: string[];
  /** 1 = add tag, 0 = remove tag */
  operation: 0 | 1;
}

interface DeleteRequest {
  urls: string[];
}

interface SubscribeRequest {
  species: string[];
}

interface SubscribeResponse {
  subscription_arn: string;
  pending_confirmation: boolean;
}

export interface SubscriptionDetails {
  subscription_arn: string;
  species: string[];
  status: string;
}

type ApiResponseObject = Record<string, unknown>;

// ── Axios instance ───────────────────────────────────────────────────────────

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
if (!apiBaseUrl) {
  console.warn('VITE_API_BASE_URL is not set — API calls will fail until configured.');
}

const apiClient = axios.create({ baseURL: apiBaseUrl });

/** Attach the Cognito idToken as a Bearer token on every outgoing request. */
apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('idToken');
  if (token && config.headers) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

/** Unwrap FastAPI's { detail: "..." } so callers see the real message. */
apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const detail = error.response?.data?.detail;
      if (detail && typeof detail === 'string') {
        error.message = detail;
      }
    }
    return Promise.reject(error);
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a QueryResultResponse into MediaItem[].
 * Prefers the `items` array (which carries file_type) so videos are never
 * misidentified by URL extension when they return a .jpg thumbnail URL.
 * Falls back to `urls` with extension-based detection for older responses.
 */
function itemsFromResponse(data: QueryResultResponse | undefined): MediaItem[] {
  if (!data) return [];
  if (data.items?.length) {
    return data.items.map((item, index) => ({
      id: `${index}-${item.url}`,
      url: item.url,
      originalUrl: item.original_url ?? item.url,
      mediaType: item.file_type === 'video' ? 'video' : 'image',
      tags: item.tags ?? {},
    }));
  }
  // Fallback: derive mediaType from URL extension (older backend responses)
  return (data.urls ?? []).map((url, index) => ({
    id: `${index}-${url}`,
    url,
    originalUrl: url,
    mediaType: /\.(mp4|mov|avi|mkv)(\?|$)/i.test(url) ? 'video' : 'image',
    tags: {},
  }));
}

/**
 * Extract the file_id (SHA-256 hex) embedded in any URL produced by the system.
 * The filename segment is `<file_id>.<ext>`, so strip the query string first
 * (presigned URLs append ?X-Amz-... parameters), take the last path segment,
 * then drop the extension.
 *
 * e.g. "https://s3.region.amazonaws.com/bucket/thumbnails/abc123.jpg?X-Amz-..." → "abc123"
 */
export function fileIdFromUrl(url: string): string {
  const path = url.split('?')[0];           // strip presigned query string
  const filename = path.split('/').pop() ?? '';
  return filename.split('.')[0];
}

/**
 * Strip presigned query parameters from any URL produced by the system.
 * Presigned S3 URLs append ?X-Amz-Algorithm=…&X-Amz-… — callers that only
 * need the stable plain URL (e.g. for copy-to-clipboard) should use this.
 */
export function plainUrl(url: string): string {
  return url.split('?')[0];
}

// ── Upload ───────────────────────────────────────────────────────────────────

/**
 * Step 1 of the upload flow: check for duplicates and obtain a presigned PUT URL.
 *
 * POST /uploads
 *
 * The browser computes a SHA-256 of the file and sends it here. The backend
 * checks the DB — if the checksum already exists it returns `duplicate: true`
 * with the existing URL so no re-upload is needed. Otherwise it returns a
 * short-lived presigned URL for a direct S3 PUT.
 *
 * @param filename    Original filename (used by the backend to derive the S3 key extension).
 * @param checksum    SHA-256 hex digest of the file, computed in the browser.
 * @param contentType MIME type of the file (e.g. "image/jpeg").
 */
export async function requestPresign(
  filename: string,
  checksum: string,
  contentType: string,
): Promise<PresignResponse> {
  const response = await apiClient.post<PresignResponse>('/uploads', {
    filename,
    checksum,
    content_type: contentType,
  });
  return response.data;
}

/**
 * Step 2 of the upload flow: PUT the raw file bytes to the presigned S3 URL.
 *
 * This request goes directly to S3 (not through the backend), so it uses a
 * plain axios call without the Authorization interceptor. Once the object lands
 * in S3 the tagging Lambda fires automatically.
 *
 * @param presignedUrl Short-lived PUT URL returned by requestPresign.
 * @param file         The File object from the browser file picker.
 * @param contentType  Must match the ContentType used when generating the presigned URL.
 */
export async function uploadToPresigned(
  presignedUrl: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void,
  extraHeaders?: Record<string, string>,
): Promise<void> {
  await axios.put(presignedUrl, file, {
    headers: { 'Content-Type': contentType, ...extraHeaders },
    onUploadProgress: onProgress
      ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)); }
      : undefined,
  });
}

// ── Media queries ─────────────────────────────────────────────────────────────

/**
 * Find media by tag counts (logical AND).
 *
 * GET /media?tag=koala:2&tag=wombat:1
 *
 * Sends a `{species: minCount}` map as repeated `tag` query parameters in the
 * format `species:minCount`. The backend returns files that contain ALL listed
 * species at or above the specified minimum count. For images the response
 * contains thumbnail URLs; for videos the full URL is returned.
 *
 * @param tags Map of species name → minimum required count, e.g. { koala: 2, dingo: 1 }.
 * @returns Array of matching thumbnail/video URLs.
 */
export async function queryMediaByTags(tags: TagCountMap): Promise<MediaItem[]> {
  const params = new URLSearchParams();
  for (const [species, count] of Object.entries(tags)) {
    params.append('tag', `${species}:${count}`);
  }
  const response = await apiClient.get<QueryResultResponse>('/media', { params });
  return itemsFromResponse(response.data);
}

/**
 * Find media containing any of the given species (count >= 1 each, logical AND).
 *
 * GET /media?species=koala&species=dingo
 *
 * Multiple species are treated as AND (all must be present at count >= 1).
 *
 * @param species One or more species names, e.g. ["koala", "dingo"].
 * @returns Array of matching thumbnail/video URLs.
 */
export async function queryMediaBySpecies(species: string[]): Promise<MediaItem[]> {
  const params = new URLSearchParams();
  for (const s of species) {
    params.append('species', s);
  }
  const response = await apiClient.get<QueryResultResponse>('/media', { params });
  return itemsFromResponse(response.data);
}

/**
 * Resolve a file_id (extracted from any system URL) to its full-size original URL.
 *
 * GET /media/{file_id}
 *
 * The file_id is the SHA-256 of the file content and is embedded in every
 * URL produced by the system. Use `fileIdFromUrl()` to extract it from a
 * thumbnail URL before calling this function.
 *
 * @param fileId SHA-256 hex string embedded in any system URL.
 * @returns Array with one element (the full-size URL), or empty if not found.
 */
export async function queryMediaByFileId(fileId: string): Promise<MediaItem[]> {
  const response = await apiClient.get<FullImageResponse>(`/media/${fileId}`);
  const url = response.data?.file_url;
  if (!url) return [];
  const mediaType: MediaItem['mediaType'] =
    /\.(mp4|mov|avi|mkv)(\?|$)/i.test(url) ? 'video' : 'image';
  return [{ id: `0-${url}`, url, originalUrl: url, mediaType, tags: response.data.tags ?? {} }];
}

/**
 * Resolve a thumbnail URL to its full-size original URL.
 *
 * Extracts the file_id from the thumbnail URL and calls GET /media/{file_id}.
 * The response URL is the original file (video or image), so mediaType is
 * detected from the extension of that original URL — which is correct.
 *
 * @param thumbnailUrl Thumbnail URL previously returned by a tag/species query.
 * @returns Array with one element, or empty if not found.
 */
export async function queryMediaByThumbnail(thumbnailUrl: string): Promise<MediaItem[]> {
  const fileId = fileIdFromUrl(thumbnailUrl);
  return queryMediaByFileId(fileId);
}

/** Compute SHA-256 hex digest of a File in the browser. */
async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Video file extensions that trigger the async polling path. */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);

function isVideoFile(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(ext);
}

/**
 * Poll GET /media/similar/result/{job_id} until the ML Lambda finishes.
 * Resolves with the matching items, or rejects after `maxWaitMs` ms.
 */
async function pollVideoResult(jobId: string, maxWaitMs = 300_000): Promise<MediaItem[]> {
  const intervalMs = 3_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const resp = await apiClient.get<QueryResultResponse | { status: string }>(
      `/media/similar/result/${jobId}`,
    );

    if (resp.status === 202) {
      // Still processing — keep polling.
      continue;
    }

    // 200 — done.
    return itemsFromResponse(resp.data as QueryResultResponse);
  }

  throw new Error('Video analysis timed out after 5 minutes. Please try again with a shorter clip.');
}

/**
 * Find media whose detected species match those in the uploaded file.
 *
 * Images — synchronous path (unchanged):
 *   1. POST /media/similar/presign  → { upload_url, s3_key }
 *   2. PUT file bytes directly to S3
 *   3. POST /media/similar { s3_key } → QueryResult (waits synchronously, <29 s)
 *
 * Videos — asynchronous path (bypasses API Gateway's 29-second limit):
 *   Steps 1–2 identical.
 *   3. POST /media/similar { s3_key } → 202 { job_id } immediately
 *   4. Poll GET /media/similar/result/{job_id} every 3 s until 200 or timeout.
 *
 * The query file is never stored in the database.
 */
export async function queryMediaByFile(file: File): Promise<MediaItem[]> {
  const contentType = file.type || 'application/octet-stream';

  // Dedup short-circuit: query OCI NoSQL directly using the SHA-256 as file_id.
  // This only checks the database — not S3 — so a file that is still being
  // processed by the ML pipeline (in S3 but not yet in OCI) correctly falls
  // through to the normal find-similar flow instead of erroring.
  const checksum = await sha256Hex(file);
  try {
    const existing = await queryMediaByFileId(checksum);
    const knownTags = existing[0]?.tags ?? {};
    if (Object.keys(knownTags).length > 0) {
      return queryMediaByTags(Object.fromEntries(
        Object.entries(knownTags).map(([species]) => [species, 1]),
      ));
    }
    // Record exists in OCI but has no tags yet — fall through to ML path.
  } catch {
    // 404: file not in OCI (never uploaded or still processing) — fall through.
  }

  // Step 1: presign
  const presignForm = new FormData();
  presignForm.append('filename', file.name);
  presignForm.append('content_type', contentType);
  const presignResp = await apiClient.post<{ upload_url: string; s3_key: string }>(
    '/media/similar/presign',
    presignForm,
  );
  const { upload_url, s3_key } = presignResp.data;

  // Step 2: PUT file directly to S3
  await fetch(upload_url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': contentType },
  });

  // Step 3: trigger ML inference
  const queryForm = new FormData();
  queryForm.append('s3_key', s3_key);

  if (isVideoFile(file)) {
    // Async path — POST returns 202 immediately with a job_id
    const triggerResp = await apiClient.post<{ job_id: string; status: string }>(
      '/media/similar',
      queryForm,
    );
    const { job_id } = triggerResp.data;

    // Step 4: poll until result is ready
    return pollVideoResult(job_id);
  }

  // Synchronous path for images — unchanged behaviour
  const response = await apiClient.post<QueryResultResponse>('/media/similar', queryForm);
  return itemsFromResponse(response.data);
}

// ── Tag management ───────────────────────────────────────────────────────────

/**
 * Add or remove tags from multiple files in a single call (bulk tag edit).
 *
 * POST /media/tags
 *
 * For `operation = 1` (add): each listed tag is added with count 1 if not
 * already present; existing counts are preserved.
 * For `operation = 0` (remove): each listed tag is removed; tags not on the
 * file are silently ignored.
 *
 * @param urls      List of file URLs to modify (any URL previously returned by the system).
 * @param tags      Tag names to add or remove.
 * @param operation 1 = add, 0 = remove.
 */
export async function bulkTagEdit(
  urls: string[],
  tags: string[],
  operation: 0 | 1,
): Promise<ApiResponseObject> {
  const payload: BulkTagEditRequest = { urls, tags, operation };
  const response = await apiClient.post<ApiResponseObject>('/media/tags', payload);
  return response.data;
}

/**
 * Delete files, their thumbnails, detection JSON, and all database records.
 *
 * DELETE /media
 *
 * Only the uploading user may delete their own files.
 *
 * @param urls List of file URLs to delete.
 */
export async function deleteMedia(urls: string[]): Promise<ApiResponseObject> {
  const payload: DeleteRequest = { urls };
  const response = await apiClient.delete<ApiResponseObject>('/media', { data: payload });
  return response.data;
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

export async function getNotificationSubscription(): Promise<SubscriptionDetails | null> {
  const response = await apiClient.get<SubscriptionDetails | null>('/subscriptions');
  return response.data;
}

export async function subscribeToNotifications(species: string[]): Promise<SubscribeResponse> {
  const payload: SubscribeRequest = { species };
  const response = await apiClient.post<SubscribeResponse>('/subscriptions', payload);
  return response.data;
}

export async function cancelNotificationSubscription(): Promise<void> {
  await apiClient.delete('/subscriptions');
}
