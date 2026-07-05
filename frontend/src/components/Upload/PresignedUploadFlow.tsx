import { useRef, useState, useCallback } from 'react';
import { useUpload } from '../../hooks/useUpload';
import { requestPresign } from '../../lib/apiClient';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type DupCheck = 'idle' | 'checking' | 'duplicate' | 'new';

export default function PresignedUploadFlow() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dupCheck, setDupCheck] = useState<DupCheck>('idle');
  // ref to cancel a stale check if the user swaps the file quickly
  const checkIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { status, setStatus, uploadProgress, uploadFile } = useUpload();

  const runDupCheck = useCallback(async (f: File) => {
    const id = ++checkIdRef.current;
    setDupCheck('checking');
    try {
      const checksum = await sha256hex(f);
      if (id !== checkIdRef.current) return; // file changed while we were hashing
      const result = await requestPresign(f.name, checksum, f.type || 'application/octet-stream');
      if (id !== checkIdRef.current) return; // file changed while we were fetching
      setDupCheck(result.duplicate ? 'duplicate' : 'new');
    } catch {
      if (id === checkIdRef.current) setDupCheck('idle'); // network error — silently reset
    }
  }, []);

  function acceptFile(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setStatus('');
    setDupCheck('idle');
    void runDupCheck(f);
  }

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    acceptFile(e.dataTransfer.files[0]);
  }

  async function handleUpload() {
    if (!file) return;
    setIsLoading(true);
    try {
      const result = await uploadFile(file);
      window.dispatchEvent(new CustomEvent('ecolens:upload', {
        detail: {
          url: result.file_url,
          filename: file.name,
          fileType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          uploadedAt: new Date().toISOString(),
          isDuplicate: result.duplicate,
        },
      }));
      setFile(null);
      setDupCheck('idle');
    } catch (error) {
      setStatus(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  }

  // Derive drop zone modifier classes
  const zoneClass = [
    'upload-dropzone',
    isDragging ? 'dragging' : '',
    file && dupCheck !== 'duplicate' ? 'has-file' : '',
    file && dupCheck === 'duplicate' ? 'is-duplicate' : '',
  ].filter(Boolean).join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h2>Upload Media</h2>
      <p>Drag and drop a file, or click to browse. Duplicates are detected automatically.</p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => acceptFile(e.target.files?.[0])}
      />

      <div
        className={zoneClass}
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        aria-label="Upload file drop zone"
        style={{ flexGrow: 1 }}
      >
        {!file || isDragging ? (
          /* ── Idle / dragging ── */
          <div className="upload-dropzone-content">
            <div className={`upload-dropzone-icon${isDragging ? ' upload-dropzone-icon--drag' : ''}`}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <p className="upload-dropzone-label">{isDragging ? 'Drop to upload' : 'Drag & drop a file here'}</p>
            {!isDragging && (
              <p className="upload-dropzone-meta">or <span className="upload-dropzone-browse">click to browse</span> · images &amp; videos</p>
            )}
          </div>
        ) : dupCheck === 'checking' ? (
          /* ── Hashing + checking ── */
          <div className="upload-dropzone-content">
            <div className="upload-dropzone-icon upload-dropzone-icon--checking">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="spin">
                <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
              </svg>
            </div>
            <p className="upload-dropzone-label">Checking for duplicates…</p>
            <p className="upload-dropzone-meta">{file.name} · {formatFileSize(file.size)}</p>
          </div>
        ) : dupCheck === 'duplicate' ? (
          /* ── Duplicate found ── */
          <div className="upload-dropzone-content">
            <div className="upload-dropzone-icon upload-dropzone-icon--dup">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <p className="upload-dropzone-label upload-dropzone-label--dup">Duplicate detected</p>
            <p className="upload-dropzone-meta">{file.name} · already exists in the system · click to change</p>
          </div>
        ) : (
          /* ── New file ready ── */
          <div className="upload-dropzone-content">
            <div className="upload-dropzone-icon upload-dropzone-icon--ready">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <p className="upload-dropzone-filename">{file.name}</p>
            <p className="upload-dropzone-meta">{formatFileSize(file.size)} · new file · click to change</p>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {uploadProgress !== null && (
        <div className="upload-progress-wrap">
          <div className="upload-progress-header">
            <span>Uploading…</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="upload-progress-track">
            <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
        <button
          className="btn"
          type="button"
          onClick={handleUpload}
          disabled={!file || isLoading || dupCheck === 'checking' || dupCheck === 'duplicate'}
          style={{ alignSelf: 'flex-start' }}
        >
          {isLoading && uploadProgress === null ? 'Preparing…' : isLoading ? 'Uploading…' : 'Upload File'}
        </button>

        {dupCheck === 'duplicate' && !isLoading && (
          <span style={{ fontSize: '13px', color: '#b45309', fontWeight: 700 }}>
            This file is already in the system.
          </span>
        )}
        {dupCheck === 'new' && !isLoading && (
          <span style={{ fontSize: '13px', color: 'var(--primary)', fontWeight: 700 }}>
            ✓ New file — ready to upload.
          </span>
        )}
      </div>

      {status && (
        <p className={`status ${status.includes('failed') ? 'error' : 'info'}`} style={{ marginTop: '16px' }}>
          {status}
        </p>
      )}
    </div>
  );
}
