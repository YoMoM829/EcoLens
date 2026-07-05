/**
 * MediaGrid.tsx
 *
 * Displays query results as a responsive grid of thumbnail cards.
 *
 * Each card shows:
 *   - Thumbnail / video preview (click → full-size modal)
 *   - Detected species tags with counts, e.g. "Felis_catus ×1, dingo ×2"
 *   - [Copy Thumbnail URL] and [Copy File URL] buttons (icon toggles to ✓ on copy)
 *
 * Thumbnail behaviour (per requirement 4.3, 5.2):
 *   - Tag/species queries return thumbnail URLs for images.
 *   - Clicking opens a modal showing the full-size original.
 *   - Videos use their direct URL in both card and modal.
 */

import { useEffect, useRef, useState } from 'react';
import { plainUrl } from '../../lib/apiClient';
import type { MediaItem } from '../../lib/apiClient';

// ── Video first-frame capture ─────────────────────────────────────────────────

/**
 * Captures the first frame of a video URL onto a <canvas> and displays it as
 * a static thumbnail image. Falls back to a neutral placeholder if the video
 * cannot be loaded (e.g. CORS, network error).
 */
function VideoFirstFrame({ src, className }: { src: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [captured, setCaptured] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    function capture() {
      if (!video || !canvas) return;
      try {
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        setCaptured(true);
      } catch {
        setFailed(true);
      }
    }

    function onSeeked() { capture(); }
    function onLoaded() {
      // Seek slightly past 0 — some browsers show a black frame at t=0
      video!.currentTime = 0.001;
    }
    function onError() { setFailed(true); }

    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
  }, [src]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Hidden video used only for frame extraction */}
      <video
        ref={videoRef}
        src={src}
        preload="auto"
        muted
        playsInline
        crossOrigin="anonymous"
        style={{ display: 'none' }}
      />
      {/* Canvas shows the captured frame */}
      <canvas
        ref={canvasRef}
        className={className}
        style={{ display: captured ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {/* Placeholder while loading or if capture failed */}
      {!captured && (
        <div style={{
          width: '100%', height: '100%', minHeight: '140px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: '#1a1a2e', color: '#aaa', fontSize: '13px', gap: '8px',
        }}>
          <span style={{ fontSize: '32px' }}>{failed ? '🎬' : '⏳'}</span>
          <span>{failed ? 'Video' : 'Loading preview…'}</span>
        </div>
      )}
    </div>
  );
}

interface MediaGridProps {
  items: MediaItem[];
  selectedMedia: MediaItem | null;
  fullImageUrl: string | null;
  onSelect: (media: MediaItem | null) => void;
  /** When true, skip rendering the card grid (modal still works). Used by thumbnail mode. */
  hideGrid?: boolean;
}

// ── Icons ────────────────────────────────────────────────────────────────────

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation(); // don't bubble up to the card click handler
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <button
      type="button"
      className="tbl-copy-btn"
      onClick={handleCopy}
      title={`Copy ${label}`}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span>{copied ? 'Copied!' : label}</span>
    </button>
  );
}

// ── Tag display ───────────────────────────────────────────────────────────────

function TagLine({ tags }: { tags: Record<string, number> }) {
  const entries = Object.entries(tags);
  if (!entries.length) {
    return (
      <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 0 10px', fontStyle: 'italic' }}>
        No tags detected
      </p>
    );
  }
  const formatted = entries
    .sort(([, a], [, b]) => b - a) // highest count first
    .map(([species, count]) => `${species} ×${count}`)
    .join(',  ');
  return (
    <p style={{ fontSize: '12px', color: 'var(--text)', margin: '0 0 10px', lineHeight: '1.5' }}>
      {formatted}
    </p>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MediaGrid({ items, selectedMedia, fullImageUrl, onSelect, hideGrid }: MediaGridProps) {
  if (!items?.length && !selectedMedia) return null;

  const modalSrc = fullImageUrl ?? selectedMedia?.url ?? '';
  const isResolving = selectedMedia !== null && fullImageUrl === null;

  return (
    <>
      {!hideGrid && <section className="grid">
        {items.map((item) => (
          <article className="result-card" key={item.id}>
            {/* Thumbnail / video preview */}
            <div
              className="thumbnail-preview"
              onClick={() => onSelect(item)}
              style={{ cursor: 'pointer' }}
              role="button"
              aria-label="Preview media"
            >
              {item.mediaType === 'video' ? (
                <VideoFirstFrame src={item.url} className="thumbnail-media" />
              ) : (
                <img alt="Wildlife media thumbnail" className="thumbnail-media" src={item.url} />
              )}
              {item.mediaType === 'video' && (
                <span className="media-badge">VIDEO</span>
              )}
            </div>

            <div style={{ padding: '12px 14px' }}>
              {/* Tags */}
              <TagLine tags={item.tags} />

              {/* Copy buttons.
                  Videos: backend returns full video URL as `url` (per requirement) —
                  there is no separate thumbnail URL in the response, so only one
                  copy button is shown.
                  Images: `url` = thumbnail, `originalUrl` = full-size original. */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {item.mediaType === 'image' && (
                  <CopyButton text={plainUrl(item.url)} label="Thumbnail URL" />
                )}
                <CopyButton
                  text={plainUrl(item.originalUrl)}
                  label={item.mediaType === 'video' ? 'Video URL' : 'File URL'}
                />
              </div>
            </div>
          </article>
        ))}
      </section>}

      {/* Full-size modal */}
      {selectedMedia && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Media preview"
          onClick={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2 style={{ margin: 0, flex: 1 }}>
                {selectedMedia.mediaType === 'video' ? 'Video Preview' : 'Full-Size Image'}
              </h2>

              {/* Open in new tab */}
              {!isResolving && fullImageUrl && (
                <a
                  className="btn btn-outline"
                  href={fullImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '10px' }}
                >
                  <ExternalLinkIcon />
                  {selectedMedia.mediaType === 'video' ? 'Open Video' : 'Open Image'}
                </a>
              )}

              {/* Close button — same style as Open Image */}
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => onSelect(null)}
                aria-label="Close"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                Close
              </button>
            </div>

            <div className="modal-body">
              {isResolving ? (
                <img
                  alt="Loading…"
                  className="modal-media"
                  src={selectedMedia.url}
                  style={{ opacity: 0.6 }}
                />
              ) : selectedMedia.mediaType === 'video' ? (
                <video controls className="modal-media" src={modalSrc} />
              ) : (
                <img alt="Full-size wildlife image" className="modal-media" src={modalSrc} />
              )}

              {isResolving && (
                <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                  Loading…
                </p>
              )}

              {!isResolving && (
                <div style={{ padding: '10px 4px 2px' }}>
                  <TagLine tags={selectedMedia.tags} />
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </>
  );
}
