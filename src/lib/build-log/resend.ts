import { Resend } from 'resend';

/** Resend Automation event that owns the subscription workflow. */
export const BUILD_LOG_SUBSCRIBED_EVENT = 'build-log.subscribed';

export async function triggerBuildLogSubscription(
	apiKey: string,
	email: string
): Promise<{ ok: true } | { ok: false }> {
	try {
		const { error } = await new Resend(apiKey).events.send({
			event: BUILD_LOG_SUBSCRIBED_EVENT,
			email
		});

		return error ? { ok: false } : { ok: true };
	} catch {
		return { ok: false };
	}
}
