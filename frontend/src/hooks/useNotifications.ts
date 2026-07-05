import { useState, useEffect, useCallback } from 'react';
import {
  getNotificationSubscription,
  subscribeToNotifications,
  cancelNotificationSubscription,
} from '../lib/apiClient';
import type { SubscriptionDetails } from '../lib/apiClient';

function friendlyError(error: unknown, context: 'subscribe' | 'cancel' | 'load'): string {
  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes('pending subscription confirmation') || msg.includes('pending')) {
    return 'You have a pending confirmation email. Please click the link in your inbox to activate alerts, then try again.';
  }
  if (msg.includes('SNS_TOPIC_ARN') || msg.includes('not configured')) {
    return 'Email alerts are not configured on this server. Please contact the administrator.';
  }
  if (msg.includes('No email address')) {
    return 'Your account does not have a verified email address. Please update your profile and try again.';
  }
  if (msg.includes('No active subscription')) {
    return 'No active subscription was found — it may have already been cancelled.';
  }
  if (context === 'subscribe') {
    return 'Could not save your subscription. Please wait a moment and try again.';
  }
  if (context === 'cancel') {
    return 'Could not cancel your subscription. Please wait a moment and try again.';
  }
  return 'Could not load your subscription status. Please refresh the page.';
}

export interface UseNotificationsResult {
  subscription: SubscriptionDetails | null;
  loading: boolean;
  status: string;
  subscribe: (species: string[]) => Promise<void>;
  cancel: () => Promise<void>;
}

export function useNotifications(): UseNotificationsResult {
  const [subscription, setSubscription] = useState<SubscriptionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  const fetchSubscription = useCallback(async () => {
    setLoading(true);
    try {
      const sub = await getNotificationSubscription();
      setSubscription(sub);
    } catch (error) {
      setSubscription(null);
      setStatus(friendlyError(error, 'load'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchSubscription(); }, [fetchSubscription]);

  async function subscribe(species: string[]): Promise<void> {
    setStatus('Saving…');
    try {
      await subscribeToNotifications(species);
      await fetchSubscription();
      setStatus(
        subscription
          ? `Updated — now watching: ${species.join(', ')}.`
          : `Subscribed! Check your email and click the confirmation link to activate alerts.`,
      );
    } catch (error) {
      setStatus(friendlyError(error, 'subscribe'));
    }
  }

  async function cancel(): Promise<void> {
    setStatus('Cancelling…');
    try {
      await cancelNotificationSubscription();
      setSubscription(null);
      setStatus('Subscription cancelled.');
    } catch (error) {
      setStatus(friendlyError(error, 'cancel'));
    }
  }

  return { subscription, loading, status, subscribe, cancel };
}
