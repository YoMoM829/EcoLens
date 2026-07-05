import { useState } from 'react';
import { bulkTagEdit } from '../../lib/apiClient';

interface TagUpdateResult {
  updated: number;
  not_found: string[];
}

export default function BulkTagEditor() {
  const [urlsText, setUrlsText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [operation, setOperation] = useState<'1' | '0'>('1');
  const [result, setResult] = useState<TagUpdateResult | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const urls = urlsText.split('\n').map((u) => u.trim()).filter(Boolean);
  const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);

  async function handleTagUpdate() {
    if (urls.length === 0 || tags.length === 0) {
      setError('Enter at least one URL and one tag.');
      setResult(null);
      return;
    }
    setIsLoading(true);
    setResult(null);
    setError('');
    try {
      const data = await bulkTagEdit(urls, tags, operation === '1' ? 1 : 0) as unknown as TagUpdateResult;
      setResult(data);
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }

  const verb = operation === '1' ? 'added to' : 'removed from';

  return (
    <div>
      <p style={{ fontSize: '15px', color: 'var(--muted)', marginBottom: '20px', marginTop: 0 }}>
        Add or remove tags across multiple files at once. You can edit tags on any file in the system.
      </p>

      <label htmlFor="bulk-urls">File URLs (one per line)</label>
      <textarea
        id="bulk-urls"
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

      <label htmlFor="bulk-tags">Tags (comma-separated)</label>
      <input
        id="bulk-tags"
        value={tagsText}
        onChange={(e) => setTagsText(e.target.value)}
        placeholder="e.g. koala, dingo, wombat"
      />

      <label htmlFor="bulk-operation">Action</label>
      <select
        id="bulk-operation"
        value={operation}
        onChange={(e) => setOperation(e.target.value === '1' ? '1' : '0')}
        style={{ marginBottom: '16px' }}
      >
        <option value="1">Add these tags</option>
        <option value="0">Remove these tags</option>
      </select>

      <button
        className="btn"
        type="button"
        onClick={handleTagUpdate}
        disabled={isLoading || urls.length === 0 || tags.length === 0}
      >
        {isLoading ? 'Processing…' : 'Update Tags'}
      </button>

      {error && (
        <p className="status error" style={{ marginTop: '16px' }}>{error}</p>
      )}
      {result && (
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {result.updated > 0 && (
            <p className="status info">
              Tags {verb} {result.updated} file{result.updated !== 1 ? 's' : ''}.
            </p>
          )}
          {result.updated === 0 && result.not_found.length === 0 && (
            <p className="status info">
              No changes made — the tags were already {operation === '1' ? 'present on' : 'absent from'} all files.
            </p>
          )}
          {result.not_found.length > 0 && (
            <p className="status error">
              {result.not_found.length} URL{result.not_found.length !== 1 ? 's' : ''} not found — the file may have been deleted or the URL is incorrect.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
