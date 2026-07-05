import { useState } from 'react';
import type { SubscriptionDetails } from '../../lib/apiClient';

interface SubscribeFormProps {
  subscription: SubscriptionDetails | null;
  loading: boolean;
  status: string;
  onSubmit: (species: string[]) => Promise<void>;
  onCancel: () => Promise<void>;
}

export default function SubscribeForm({
  subscription,
  loading,
  status,
  onSubmit,
  onCancel,
}: SubscribeFormProps) {
  const [speciesInput, setSpeciesInput] = useState('');
  const [validationError, setValidationError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const speciesList = speciesInput
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  async function handleCancel() {
    setCancelling(true);
    await onCancel();
    setCancelling(false);
  }

  if (loading) {
    return (
      <div>
        <h2>Email Alerts</h2>
        <p style={{ color: 'var(--muted)' }}>Loading subscription…</p>
      </div>
    );
  }

  return (
    <div>
      <h2>Email Alerts</h2>

      {/* Pending subscription */}
      {subscription?.status === 'pending_confirmation' && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '14px 16px',
          marginBottom: '24px',
          position: 'relative',
        }}>
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            title="Cancel pending subscription"
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'var(--danger, #e53e3e)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: cancelling ? 'not-allowed' : 'pointer',
              opacity: cancelling ? 0.6 : 1,
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
          <p style={{ fontWeight: 700, marginBottom: '6px', paddingRight: '80px' }}>Subscription pending</p>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: 0 }}>
            Check your email and click the confirmation link to activate alerts.
            Once confirmed, your species list will appear here.
          </p>
        </div>
      )}

      {/* Confirmed subscription */}
      {subscription?.status === 'confirmed' && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '14px 16px',
          marginBottom: '24px',
          position: 'relative',
        }}>
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            title="Cancel subscription"
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'var(--danger, #e53e3e)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: cancelling ? 'not-allowed' : 'pointer',
              opacity: cancelling ? 0.6 : 1,
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
          <p style={{ fontWeight: 700, marginBottom: '6px', paddingRight: '80px' }}>Current subscription</p>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>
            Status: <span style={{ color: 'var(--primary)', fontWeight: 600 }}>confirmed</span>
          </p>
          <p style={{ fontSize: '13px', marginBottom: 0 }}>
            Watching: {subscription.species.map((s) => (
              <code key={s} style={{ marginRight: '6px' }}>{s}</code>
            ))}
          </p>
        </div>
      )}

      {/* Subscribe / update form */}
      <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '16px' }}>
        {subscription?.status === 'confirmed'
          ? 'Enter new species below to update your watched species.'
          : subscription?.status === 'pending_confirmation'
          ? 'You can re-subscribe with a new species list — this will cancel the pending subscription and send a fresh confirmation email.'
          : 'Enter species to watch. You will receive a confirmation email before alerts begin.'}
      </p>

      <label htmlFor="subscribe-species">Species to watch (comma-separated)</label>
      <input
        id="subscribe-species"
        value={speciesInput}
        onChange={(e) => { setSpeciesInput(e.target.value); setValidationError(''); }}
        placeholder="koala, dingo, wombat"
        style={{ marginBottom: '4px' }}
      />
      {speciesList.length > 0 && (
        <p style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 700, marginBottom: '16px' }}>
          {speciesList.join(' · ')}
        </p>
      )}

      {validationError && (
        <p style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '12px' }}>
          {validationError}
        </p>
      )}

      <button
        className="btn"
        type="button"
        onClick={() => {
          if (speciesList.length === 0) {
            setValidationError('Enter at least one species.');
            return;
          }
          void onSubmit(speciesList);
        }}
      >
        {subscription?.status === 'confirmed' ? 'Update Subscription' : 'Subscribe'}
      </button>

      {status && (
        <p
          className={`status ${status.startsWith('Failed') ? 'error' : 'info'}`}
          style={{ marginTop: '16px' }}
        >
          {status}
        </p>
      )}
    </div>
  );
}
