/**
 * useUserUploads.ts
 *
 * Tracks uploaded files per user in localStorage so they appear in the
 * "My Uploads" table on the Dashboard. The backend has no list-my-files
 * endpoint, so we maintain this record client-side.
 *
 * Storage key: `ecolens_uploads_<email>`
 */

import { useCallback, useState } from 'react';

export interface UploadRecord {
  /** Original file URL returned by the presign endpoint. */
  url: string;
  /** Thumbnail URL — only available for images, generated asynchronously by the ML pipeline. */
  thumbnailUrl?: string;
  filename: string;
  fileType: string;
  sizeBytes: number;
  uploadedAt: string;
  isDuplicate: boolean;
  /** Species tags from the ML pipeline — populated asynchronously, may be absent. */
  tags?: Record<string, number>;
}

function storageKey(email: string): string {
  return `ecolens_uploads_${email}`;
}

function loadRecords(email: string | null): UploadRecord[] {
  if (!email) return [];
  try {
    const raw = localStorage.getItem(storageKey(email));
    return raw ? (JSON.parse(raw) as UploadRecord[]) : [];
  } catch {
    return [];
  }
}

function saveRecords(email: string, records: UploadRecord[]): void {
  localStorage.setItem(storageKey(email), JSON.stringify(records));
}

export function useUserUploads(userEmail: string | null) {
  const [uploads, setUploads] = useState<UploadRecord[]>(() => loadRecords(userEmail));

  const addUpload = useCallback(
    (record: UploadRecord) => {
      if (!userEmail) return;
      setUploads((prev) => {
        // Avoid duplicate entries for the same URL
        const filtered = prev.filter((r) => r.url !== record.url);
        const next = [record, ...filtered];
        saveRecords(userEmail, next);
        return next;
      });
    },
    [userEmail],
  );

  const refresh = useCallback(() => {
    setUploads(loadRecords(userEmail));
  }, [userEmail]);

  const clear = useCallback(() => {
    if (!userEmail) return;
    localStorage.removeItem(storageKey(userEmail));
    setUploads([]);
  }, [userEmail]);

  return { uploads, addUpload, refresh, clear };
}
