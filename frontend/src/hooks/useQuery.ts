/**
 * useQuery.ts
 *
 * Orchestrates all four media query modes:
 *   - Tag-count query  (logical AND, minimum counts per species)
 *   - Species query    (one or more species, count >= 1 each, logical AND)
 *   - Thumbnail lookup (resolve thumbnail URL → full-size image URL)
 *   - File-based query (detect species in an uploaded file, return matching DB records)
 *
 * Also handles the "open thumbnail → show full-size" requirement:
 * when an image item is selected for modal preview, the hook automatically
 * resolves its thumbnail URL to the original full-size image URL via
 * POST /query/thumbnail, so the modal always shows the highest-quality image.
 *
 * Tag/species queries return thumbnail URLs for images and full URLs for videos
 * (as specified by the backend). Videos are identified by file extension.
 */

import axios from 'axios';
import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  queryMediaByFile,
  queryMediaBySpecies,
  queryMediaByTags,
  queryMediaByThumbnail,
} from '../lib/apiClient';
import type { MediaItem, TagCountMap } from '../lib/apiClient';

/** Extract a clean, user-facing message from any thrown error. */
function friendlyError(error: unknown, context: 'tag' | 'species' | 'thumbnail' | 'file'): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    // Try to use a message from the response body first
    const detail: string | undefined =
      error.response?.data?.detail ?? error.response?.data?.message;
    if (detail) return detail;

    switch (status) {
      case 400: return 'Invalid search input — please check your parameters and try again.';
      case 401: return 'Your session has expired — please sign in again.';
      case 404:
        if (context === 'thumbnail') return 'No file found for that thumbnail URL.';
        return 'No matching files found.';
      case 502:
      case 503:
        if (context === 'file') return 'ML analysis service is unavailable — please try again shortly.';
        return 'Server error — please try again shortly.';
      default:
        if (status) return `Unexpected server error (${status}) — please try again.`;
    }
  }
  // Plain Error thrown by application code (e.g. polling timeout message)
  if (error instanceof Error && error.message)
    return error.message;
  return 'Something went wrong — please try again.';
}
// queryMediaByThumbnail now extracts the file_id from the URL client-side
// and calls GET /media/{file_id} — no change needed in this hook.

export type { MediaItem };

export interface UseQueryResult {
  /** Human-readable query status (running / found N results / error message). */
  status: string;
  /** True while a query is in-flight (drives loading spinner). */
  isLoading: boolean;
  /** True when the last query ended in an error (drives the red banner). */
  isError: boolean;
  /** Results list shown in the media grid. Images carry thumbnail URLs. */
  results: MediaItem[];
  /** The item whose modal is currently open, or null if no modal is shown. */
  selectedMedia: MediaItem | null;
  /**
   * Resolved full-size URL for the selected image.
   * Null while resolving or when a video is selected (videos link directly).
   * Falls back to the thumbnail URL if resolution fails.
   */
  fullImageUrl: string | null;
  setSelectedMedia: Dispatch<SetStateAction<MediaItem | null>>;
  runTagQuery: (tags: TagCountMap) => Promise<void>;
  runSpeciesQuery: (species: string[]) => Promise<void>;
  runThumbnailQuery: (thumbnailUrl: string) => Promise<void>;
  runFileQuery: (file: File) => Promise<void>;
}

// Query functions now return MediaItem[] directly (with file_type from the backend),
// so no URL-to-MediaItem mapping is needed here.

/**
 * Hook that manages query state, results, and the selected-item modal.
 *
 * @example
 * const { results, runTagQuery, fullImageUrl, selectedMedia, setSelectedMedia } = useQuery();
 */
export function useQuery(): UseQueryResult {
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [results, setResults] = useState<MediaItem[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);

  function setOk(msg: string) { setStatus(msg); setIsError(false); }
  function setErr(msg: string) { setStatus(msg); setIsError(true); }

  /**
   * Whenever the selected item changes to an image, resolve its thumbnail URL
   * to the full-size original via the /query/thumbnail endpoint.
   * This satisfies the requirement: "users can request the full-size image
   * by clicking on them."
   */
  // When any item is selected, resolve its thumbnail URL to the original full-size
  // file URL via GET /media/{file_id}. This works for both images (full-size JPEG)
  // and videos (original .mp4 URL for the <video> element in the modal).
  useEffect(() => {
    if (!selectedMedia) {
      setFullImageUrl(null);
      return;
    }

    let cancelled = false;
    queryMediaByThumbnail(selectedMedia.url)
      .then((items) => {
        if (!cancelled) setFullImageUrl(items[0]?.url ?? selectedMedia.url);
      })
      .catch(() => {
        if (!cancelled) setFullImageUrl(selectedMedia.url);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedMedia]);

  async function runTagQuery(tags: TagCountMap): Promise<void> {
    setIsLoading(true); setOk('Searching by tag counts…');
    try {
      const items = await queryMediaByTags(tags);
      setResults(items);
      setSelectedMedia(null);
      setOk(items.length ? `Found ${items.length} matching file(s).` : 'No files matched those tag counts.');
    } catch (error) {
      setErr(friendlyError(error, 'tag'));
    } finally { setIsLoading(false); }
  }

  async function runSpeciesQuery(species: string[]): Promise<void> {
    setIsLoading(true); setOk('Searching by species…');
    try {
      const items = await queryMediaBySpecies(species);
      setResults(items);
      setSelectedMedia(null);
      setOk(items.length ? `Found ${items.length} matching file(s).` : 'No files found for those species.');
    } catch (error) {
      setErr(friendlyError(error, 'species'));
    } finally { setIsLoading(false); }
  }

  async function runThumbnailQuery(thumbnailUrl: string): Promise<void> {
    setIsLoading(true); setOk('Resolving thumbnail URL…');
    try {
      const items = await queryMediaByThumbnail(thumbnailUrl);
      setResults(items);
      setSelectedMedia(items[0] ?? null);
      setOk(items.length ? 'Full-size image found.' : 'No file found for that thumbnail URL.');
    } catch (error) {
      setErr(friendlyError(error, 'thumbnail'));
    } finally { setIsLoading(false); }
  }

  async function runFileQuery(file: File): Promise<void> {
    setIsLoading(true); setOk('Analysing uploaded file and searching database…');
    try {
      const items = await queryMediaByFile(file);
      setResults(items);
      setSelectedMedia(null);
      setOk(items.length ? `Found ${items.length} matching file(s).` : 'No matching files found in the database.');
    } catch (error) {
      setErr(friendlyError(error, 'file'));
    } finally { setIsLoading(false); }
  }

  return {
    status,
    isLoading,
    isError,
    results,
    selectedMedia,
    fullImageUrl,
    setSelectedMedia,
    runTagQuery,
    runSpeciesQuery,
    runThumbnailQuery,
    runFileQuery,
  };
}
