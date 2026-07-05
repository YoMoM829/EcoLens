import { useState } from 'react';
import type { TagCountMap } from '../../lib/apiClient';

interface TagSearchFormProps {
  onTagQuery: (tags: TagCountMap) => Promise<void>;
  onSpeciesQuery: (species: string[]) => Promise<void>;
  /** When provided, shows only the specified mode instead of both. */
  mode?: 'tag' | 'species';
}

export default function TagSearchForm({ onTagQuery, onSpeciesQuery, mode }: TagSearchFormProps) {
  const [tagJson, setTagJson] = useState('');
  const [speciesInput, setSpeciesInput] = useState('');
  const [tagLoading, setTagLoading] = useState(false);
  const [speciesLoading, setSpeciesLoading] = useState(false);
  const [tagError, setTagError] = useState('');
  const [speciesError, setSpeciesError] = useState('');

  const speciesList = speciesInput.split(',').map((s) => s.trim()).filter(Boolean);

  async function handleTagSearch() {
    setTagError('');
    let parsed: TagCountMap;
    try {
      parsed = JSON.parse(tagJson) as TagCountMap;
    } catch {
      setTagError('Invalid JSON — use the format {"koala": 2, "dingo": 1}');
      return;
    }
    if (Object.keys(parsed).length === 0) {
      setTagError('Provide at least one species and count.');
      return;
    }
    setTagLoading(true);
    try {
      await onTagQuery(parsed);
    } catch (e) {
      setTagError(`Query failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTagLoading(false);
    }
  }

  async function handleSpeciesSearch() {
    setSpeciesError('');
    if (speciesList.length === 0) {
      setSpeciesError('Enter at least one species name.');
      return;
    }
    setSpeciesLoading(true);
    try {
      await onSpeciesQuery(speciesList);
    } catch (e) {
      setSpeciesError(`Query failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSpeciesLoading(false);
    }
  }

  return (
    <div>
      {(!mode || mode === 'tag') && (
        <>
          <h2>Search by Tag Counts</h2>
          <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '16px' }}>
            Find media where each species appears at least the given number of times (logical AND).
          </p>
          <label style={{ fontSize: '12px', fontWeight: '700' }}>
            JSON query — e.g. <code>{'{"koala": 2, "dingo": 1}'}</code>
          </label>
          <textarea
            value={tagJson}
            onChange={(e) => { setTagJson(e.target.value); setTagError(''); }}
            style={{ fontFamily: 'monospace', fontSize: '13px', minHeight: '90px' }}
            placeholder='{"koala": 1, "dingo": 2}'
            spellCheck={false}
          />
          <button className="btn" type="button" onClick={handleTagSearch} disabled={tagLoading}>
            {tagLoading ? 'Searching…' : 'Search by Tags'}
          </button>
          {tagError && (
            <p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '8px' }}>{tagError}</p>
          )}
        </>
      )}

      {(!mode || mode === 'species') && (
        <>
          <h2 style={mode ? undefined : { marginTop: '24px' }}>Search by Species</h2>
          <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '16px' }}>
            Find all media containing the listed species (count &ge; 1 each). All must be present (AND).
          </p>
          <input
            value={speciesInput}
            onChange={(e) => { setSpeciesInput(e.target.value); setSpeciesError(''); }}
            placeholder="e.g. koala, dingo, wombat"
            style={{ marginBottom: '4px' }}
          />
          {speciesList.length > 0 && (
            <p style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: '700', marginBottom: '12px' }}>
              Searching for: {speciesList.join(' · ')}
            </p>
          )}
          <button
            className="btn btn-outline"
            type="button"
            onClick={handleSpeciesSearch}
            disabled={speciesLoading || speciesList.length === 0}
          >
            {speciesLoading ? 'Searching…' : 'Search by Species'}
          </button>
          {speciesError && (
            <p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '8px' }}>{speciesError}</p>
          )}
        </>
      )}
    </div>
  );
}
