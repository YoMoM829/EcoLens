import { useState } from 'react';
import BulkTagEditor from './BulkTagEditor';
import FileDeleter from './FileDeleter';

type Tab = 'tags' | 'delete';

export default function TagManagementTabs() {
  const [activeTab, setActiveTab] = useState<Tab>('tags');

  return (
    <div>
      {/* Tab bar */}
      <div className="tab-bar">
        <button
          type="button"
          className={`tab-btn${activeTab === 'tags' ? ' active' : ''}`}
          onClick={() => setActiveTab('tags')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
            <line x1="7" y1="7" x2="7.01" y2="7"/>
          </svg>
          Bulk Tag Management
        </button>
        <button
          type="button"
          className={`tab-btn${activeTab === 'delete' ? ' active' : ''}`}
          onClick={() => setActiveTab('delete')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
          Delete Files
        </button>
      </div>

      {/* Tab content */}
      <div className="tab-content">
        {activeTab === 'tags' ? <BulkTagEditor /> : <FileDeleter />}
      </div>
    </div>
  );
}
