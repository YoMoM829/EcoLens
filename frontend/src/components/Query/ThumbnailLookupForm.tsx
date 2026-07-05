/**
 * ThumbnailLookupForm.tsx
 *
 * Implements requirement 4.3.2: find a full-size image from its thumbnail URL.
 *
 * The user pastes a thumbnail URL (e.g. copied from a previous query result).
 * The backend extracts the file checksum from the URL, looks up the DB record,
 * and returns the original full-size S3 URL.
 */

import { useState } from 'react';

interface ThumbnailLookupFormProps {
  /** Called with the entered thumbnail URL. Should throw on failure. */
  onSubmit: (thumbnailUrl: string) => Promise<void>;
}

/** Form that resolves a thumbnail URL to its full-size original. */
export default function ThumbnailLookupForm({ onSubmit }: ThumbnailLookupFormProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  return (
    <div>
      <h2>Find by Thumbnail URL</h2>
      <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '16px' }}>
        Paste a thumbnail URL to retrieve the corresponding full-size original image.
      </p>

      <input
        value={thumbnailUrl}
        onChange={(e) => { setThumbnailUrl(e.target.value); setError(''); }}
        placeholder="https://s3.amazonaws.com/bucket/thumbnails/…"
        style={{ marginBottom: '16px' }}
      />

      <button
        className="btn"
        type="button"
        onClick={async () => {
          setError('');
          setIsLoading(true);
          try {
            await onSubmit(thumbnailUrl.trim());
          } catch (e) {
            setError(`Lookup failed: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            setIsLoading(false);
          }
        }}
        disabled={isLoading || !thumbnailUrl.trim()}
      >
        {isLoading ? 'Resolving…' : 'Get Full Image'}
      </button>

      {error && (
        <p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '8px' }}>❌ {error}</p>
      )}
    </div>
  );
}
