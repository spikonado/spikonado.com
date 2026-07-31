import posthog from 'posthog-js';
import { captureAnalyticsEvent } from '@/lib/analytics/bootstrap';
import type { AnalyticsProperties } from '@/lib/analytics/events';

/** Fire-and-forget capture that never throws into product UI. */
export function captureEvent(event: string, properties?: AnalyticsProperties): void {
	try {
		captureAnalyticsEvent(event, properties);
	} catch {
		// Analytics must not break UX.
	}
}

export function captureExceptionSafe(error: unknown, properties?: AnalyticsProperties): void {
	try {
		if (!import.meta.env.PUBLIC_POSTHOG_KEY) {
			return;
		}
		posthog.captureException(error, properties);
	} catch {
		// Analytics must not break UX.
	}
}

export function posthogRequestHeaders(): Record<string, string> {
	try {
		const distinctId = posthog.get_distinct_id?.();
		const sessionId = posthog.get_session_id?.();
		return {
			...(distinctId ? { 'X-POSTHOG-DISTINCT-ID': distinctId } : {}),
			...(sessionId ? { 'X-POSTHOG-SESSION-ID': sessionId } : {})
		};
	} catch {
		return {};
	}
}

export function identifySubscriber(subscriberEmail: string): void {
	try {
		if (!import.meta.env.PUBLIC_POSTHOG_KEY) {
			return;
		}
		posthog.identify(subscriberEmail, {
			email: subscriberEmail,
			subscribed_to_build_log: true
		});
	} catch {
		// Analytics must not break UX.
	}
}
