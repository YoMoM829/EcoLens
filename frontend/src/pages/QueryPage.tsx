import { useState } from 'react';
import FileQueryForm from '../components/Query/FileQueryForm';
import TagSearchForm from '../components/Query/TagSearchForm';
import ThumbnailLookupForm from '../components/Query/ThumbnailLookupForm';
import MediaGrid from '../components/Media/MediaGrid';
import { useQuery } from '../hooks/useQuery';

type QueryMode = 'tag-count' | 'species' | 'thumbnail' | 'file';

const SIDEBAR_ITEMS: { mode: QueryMode; label: string; icon: string; description: string }[] = [
  {
    mode: 'tag-count',
    label: 'Search by Tag Counts',
    icon: '🔢',
    description: 'Find media containing species at or above a minimum count.',
  },
  {
    mode: 'species',
    label: 'Search by Species',
    icon: '🦘',
    description: 'Find media containing one or more species (count ≥ 1 each).',
  },
  {
    mode: 'thumbnail',
    label: 'Find by Thumbnail URL',
    icon: '🖼️',
    description: 'Resolve a thumbnail URL to its full-size original file.',
  },
  {
    mode: 'file',
    label: 'Find Similar by File',
    icon: '📂',
    description: 'Upload a reference file to find matches in the database.',
  },
];


export default function QueryPage() {
  const [activeMode, setActiveMode] = useState<QueryMode>('tag-count');

  // One isolated query state per mode — switching tabs preserves each mode's results.
  const tagCountQuery = useQuery();
  const speciesQuery  = useQuery();
  const thumbnailQuery = useQuery();
  const fileQuery     = useQuery();

  const queryByMode: Record<QueryMode, ReturnType<typeof useQuery>> = {
    'tag-count': tagCountQuery,
    'species':   speciesQuery,
    'thumbnail': thumbnailQuery,
    'file':      fileQuery,
  };

  const active = queryByMode[activeMode];

  return (
    <main className="container">
      <div className="page-title">
        <h1>Query Media</h1>
        <p>Select a search method from the sidebar, fill in the form, and view results below.</p>
      </div>

      <div className="query-layout">
        {/* Sidebar */}
        <aside className="query-sidebar">
          <p className="query-sidebar-heading">Search Methods</p>
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.mode}
              type="button"
              className={`query-sidebar-item ${activeMode === item.mode ? 'active' : ''}`}
              onClick={() => setActiveMode(item.mode)}
            >
              <span className="query-sidebar-icon">{item.icon}</span>
              <div>
                <div className="query-sidebar-label">{item.label}</div>
                <div className="query-sidebar-desc">{item.description}</div>
              </div>
            </button>
          ))}
        </aside>

        {/* Main area */}
        <div className="query-main">
          {/* Form */}
          <div className="card" style={{ marginBottom: '24px' }}>
            {activeMode === 'tag-count' && (
              <TagSearchForm mode="tag" onTagQuery={tagCountQuery.runTagQuery} onSpeciesQuery={tagCountQuery.runSpeciesQuery} />
            )}
            {activeMode === 'species' && (
              <TagSearchForm mode="species" onTagQuery={speciesQuery.runTagQuery} onSpeciesQuery={speciesQuery.runSpeciesQuery} />
            )}
            {activeMode === 'thumbnail' && <ThumbnailLookupForm onSubmit={thumbnailQuery.runThumbnailQuery} />}
            {activeMode === 'file' && <FileQueryForm onSubmit={fileQuery.runFileQuery} />}
          </div>

          {/* Status for the active mode */}
          {active.status && (
            <div
              className={`status ${active.isError ? 'error' : 'info'}`}
              style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {active.isLoading && (
                  <svg
                    width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                    style={{ flexShrink: 0, animation: 'spin 0.9s linear infinite' }}
                  >
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                  </svg>
                )}
                <span>{active.status}</span>
              </div>
              {active.isLoading && (
                <div style={{ height: '4px', borderRadius: '2px', background: 'rgba(0,0,0,0.12)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    borderRadius: '2px',
                    background: 'currentColor',
                    opacity: 0.5,
                    animation: 'progress-slide 1.4s ease-in-out infinite',
                  }} />
                </div>
              )}
            </div>
          )}

          {/* Results for the active mode */}
          <MediaGrid
            items={active.results}
            selectedMedia={active.selectedMedia}
            fullImageUrl={active.fullImageUrl}
            onSelect={active.setSelectedMedia}
            hideGrid={activeMode === 'thumbnail'}
          />
        </div>
      </div>
    </main>
  );
}
