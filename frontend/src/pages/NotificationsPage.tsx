import SubscribeForm from '../components/Notifications/SubscribeForm';
import { useNotifications } from '../hooks/useNotifications';

export default function NotificationsPage() {
  const { subscription, loading, status, subscribe, cancel } = useNotifications();

  return (
    <main className="container">
      <div className="page-title">
        <h1>Email Alerts</h1>
        <p>Get notified by email when new files containing specific species are detected.</p>
      </div>

      <section className="grid-2">
        <div className="card">
          <div className="card-icon">🔔</div>
          <SubscribeForm
            subscription={subscription}
            loading={loading}
            status={status}
            onSubmit={subscribe}
            onCancel={cancel}
          />
        </div>

        <div className="card">
          <h2>How It Works</h2>
          <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
            <li><strong>Enter species</strong> — type the species names you want to watch (e.g. <code>koala</code>, <code>dingo</code>) and click <strong>Subscribe</strong>.</li>
            <li><strong>Confirm your email</strong> — AWS SNS sends a confirmation email to your account address. You must click the link before alerts start.</li>
            <li><strong>Receive alerts</strong> — once confirmed, you get an email whenever a matching file is uploaded by any user.</li>
            <li><strong>Update species</strong> — after confirmation, your current subscription and a <strong>Cancel Subscription</strong> button appear on this page. Enter new species and click <strong>Update Subscription</strong> to change what you watch — no re-confirmation needed.</li>
            <li><strong>Cancel</strong> — click <strong>Cancel Subscription</strong> to stop all alerts immediately.</li>
          </ol>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '8px' }}>
            The subscription panel and Update / Cancel buttons only appear after your email is confirmed.
          </p>

          <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

          <h2>Example Species</h2>
          <p style={{ lineHeight: '1.8' }}>
            <code>koala</code> · <code>dingo</code> · <code>wombat</code> ·{' '}
            <code>magpie</code> · <code>kookaburra</code> · <code>kangaroo</code>
          </p>
          <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
            Use the Query page to discover which species are already in the system.
          </p>
        </div>
      </section>
    </main>
  );
}
