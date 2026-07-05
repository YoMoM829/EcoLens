import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { requestPresign, uploadToPresigned } from '../lib/apiClient';
import type { PresignResponse } from '../lib/apiClient';

export interface UseUploadResult {
  status: string;
  setStatus: Dispatch<SetStateAction<string>>;
  /** 0–100 while uploading to S3, null when idle or complete. */
  uploadProgress: number | null;
  uploadFile: (file: File) => Promise<PresignResponse>;
  lastUpload: PresignResponse & { filename: string; sizeBytes: number; fileType: string } | null;
}

async function sha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function useUpload(): UseUploadResult {
  const [status, setStatus] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [lastUpload, setLastUpload] = useState<UseUploadResult['lastUpload']>(null);

  async function uploadFile(file: File): Promise<PresignResponse> {
    const checksum = await sha256(file);
    const contentType = file.type || 'application/octet-stream';
    const presign = await requestPresign(file.name, checksum, contentType);

    if (presign.duplicate) {
      setStatus('Duplicate detected — file already exists in the system.');
      setLastUpload({ ...presign, filename: file.name, sizeBytes: file.size, fileType: contentType });
      return presign;
    }

    if (!presign.upload_url) {
      throw new Error('Server did not return an upload URL for a new file.');
    }

    setUploadProgress(0);
    await uploadToPresigned(presign.upload_url, file, contentType, (pct) => {
      setUploadProgress(pct);
    }, presign.upload_headers);
    setUploadProgress(null);
    setStatus('Upload complete. The ML pipeline will tag this file shortly.');
    setLastUpload({ ...presign, filename: file.name, sizeBytes: file.size, fileType: contentType });
    return presign;
  }

  return { status, setStatus, uploadProgress, uploadFile, lastUpload };
}
