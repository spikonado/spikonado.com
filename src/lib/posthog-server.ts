import { PostHog } from 'posthog-node';

/** Matches the EU project used by the browser SDK (`ui_host: https://eu.posthog.com`). */
const POSTHOG_HOST = 'https://eu.i.posthog.com';

let posthogClient: PostHog | null = null;

export function getPostHogServer(): PostHog | null {
	const apiKey = import.meta.env.PUBLIC_POSTHOG_KEY?.trim();
	if (!apiKey) {
		return null;
	}

	if (!posthogClient) {
		posthogClient = new PostHog(apiKey, {
			host: POSTHOG_HOST,
			flushAt: 1,
			flushInterval: 0
		});
	}

	return posthogClient;
}

export async function flushPostHogServer(): Promise<void> {
	if (!posthogClient) {
		return;
	}

	try {
		await posthogClient.flush();
	} catch {
		// Analytics must not break the subscribe response.
	}
}

export function captureServerException(
	error: unknown,
	distinctId: string,
	properties?: Record<string, string | number | boolean | null | undefined>
): void {
	const posthog = getPostHogServer();
	if (!posthog) {
		return;
	}

	try {
		posthog.captureException(error, distinctId, properties);
	} catch {
		// Analytics must not break the request.
	}
}
