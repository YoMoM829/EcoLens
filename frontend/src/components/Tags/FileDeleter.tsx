import { useState } from 'react';
import { deleteMedia } from '../../lib/apiClient';

interface DeleteResult {
  deleted: number;
  not_found: string[];
  forbidden: string[];
}

export default function FileDeleter() {
  const [urlsText, setUrlsText] = useState('');
  const [result, setResult] = useState<DeleteResult | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const urls = urlsText.split('\n').map((u) => u.trim()).filter(Boolean);

  async function handleDelete() {
    if (urls.length === 0) {
      setError('Enter at least one URL to delete.');
      setResult(null);
      return;
    }
    if (!confirm(`Permanently delete ${urls.length} file(s)? This cannot be undone.`)) return;
    setIsLoading(true);
    setResult(null);
    setError('');
    try {
      const data = await deleteMedia(urls) as unknown as DeleteResult;
      setResult(data);
      if (data.deleted > 0) {
        setUrlsText('');
      }
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: '15px', color: 'var(--muted)', marginBottom: '20px', marginTop: 0 }}>
        Permanently remove files, thumbnails, and all database records. You can only delete files you uploaded.
      </p>

      <label htmlFor="delete-urls">File URLs (one per line)</label>
      <textarea
        id="delete-urls"
        value={urlsText}
        onChange={(e) => setUrlsText(e.target.value)}
        placeholder={'https://s3.amazonaws.com/bucket/file1.jpg\nhttps://s3.amazonaws.com/bucket/file2.mp4'}
        style={{ minHeight: '100px', marginBottom: '4px' }}
      />
      {urls.length > 0 && (
        <p style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: '700', marginBottom: '12px' }}>
          {urls.length} URL(s) entered
        </p>
      )}

      <button
        className="btn btn-danger"
        type="button"
        onClick={handleDelete}
        disabled={isLoading || urls.length === 0}
      >
        {isLoading ? 'Deleting…' : 'Delete Files'}
      </button>

      {error && (
        <p className="status error" style={{ marginTop: '16px' }}>{error}</p>
      )}
      {result && (
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {result.deleted > 0 && (
            <p className="status info">
              {result.deleted} file{result.deleted !== 1 ? 's' : ''} deleted successfully.
            </p>
          )}
          {result.not_found.length > 0 && (
            <p className="status error">
              {result.not_found.length} URL{result.not_found.length !== 1 ? 's' : ''} not found — the file may have already been deleted.
            </p>
          )}
          {result.forbidden.length > 0 && (
            <p className="status error">
              {result.forbidden.length} file{result.forbidden.length !== 1 ? 's' : ''} could not be deleted — you can only delete files you uploaded.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
