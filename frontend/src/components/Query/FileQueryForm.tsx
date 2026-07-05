import { useRef, useState } from 'react';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileQueryFormProps {
  onSubmit: (file: File) => Promise<void>;
}

export default function FileQueryForm({ onSubmit }: FileQueryFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function acceptFile(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setError('');
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    acceptFile(e.dataTransfer.files[0]);
  }

  async function handleSubmit() {
    if (!file) return;
    setError('');
    setIsLoading(true);
    try {
      await onSubmit(file);
    } catch (e) {
      setError(`Query failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div>
      <h2>Find Similar by File</h2>
      <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '16px' }}>
        Upload a file to detect its species and find all matching records in the database.
        The file is analysed and discarded — never stored.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => acceptFile(e.target.files?.[0])}
      />

      <div
        className={`upload-dropzone${isDragging ? ' dragging' : ''}${file ? ' has-file' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        aria-label="Query file drop zone"
        style={{ marginBottom: '12px' }}
      >
        {file ? (
          <div className="upload-dropzone-content">
            <div className="upload-dropzone-icon upload-dropzone-icon--ready">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <p className="upload-dropzone-filename">{file.name}</p>
            <p className="upload-dropzone-meta">{formatFileSize(file.size)} · click to change</p>
          </div>
        ) : isDragging ? (
          <div className="upload-dropzone-content">
            <div className="upload-dropzone-icon upload-dropzone-icon--drag">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <p className="upload-dropzone-label">Drop to select</p>
          </div>
        ) : (
          <div className="upload-dropzone-content">
            <div className="upload-dropzone-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <p className="upload-dropzone-label">Drag & drop a file here</p>
            <p className="upload-dropzone-meta">or <span className="upload-dropzone-browse">click to browse</span> · images &amp; videos</p>
          </div>
        )}
      </div>

      <button
        className="btn"
        type="button"
        onClick={handleSubmit}
        disabled={isLoading || !file}
      >
        {isLoading ? 'Analysing…' : 'Search by File'}
      </button>

      {error && (
        <p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '12px' }}>{error}</p>
      )}
    </div>
  );
}
