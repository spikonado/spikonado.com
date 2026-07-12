import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { checkBotId } from 'botid/server';
import {
	NEWSLETTER_FORM,
	NEWSLETTER_SUBSCRIBE_FAILED_EVENT,
	NEWSLETTER_SUBSCRIBED_EVENT
} from '@/lib/build-log/analytics';
import { triggerBuildLogSubscription } from '@/lib/build-log/resend';
import { flushPostHogServer, getPostHogServer } from '@/lib/posthog-server';

export const prerender = false;

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Practical shape check — rejects values browsers' type=email would also reject. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
	return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
}

function json(ok: true): Response;
function json(ok: false, status: number): Response;
function json(ok: boolean, status = 200): Response {
	return Response.json(ok ? { ok: true } : { ok: false }, { status, headers: NO_STORE });
}

function posthogIds(request: Request): {
	distinctId: string | undefined;
	sessionId: string | undefined;
} {
	const distinctId = request.headers.get('X-POSTHOG-DISTINCT-ID')?.trim() || undefined;
	const sessionId = request.headers.get('X-POSTHOG-SESSION-ID')?.trim() || undefined;
	return { distinctId, sessionId };
}

async function captureNewsletterEvent(options: {
	request: Request;
	email: string;
	event: typeof NEWSLETTER_SUBSCRIBED_EVENT | typeof NEWSLETTER_SUBSCRIBE_FAILED_EVENT;
	reason?: string;
}): Promise<void> {
	const posthog = getPostHogServer();
	if (!posthog) {
		return;
	}

	const { distinctId: clientDistinctId, sessionId } = posthogIds(options.request);
	const distinctId = clientDistinctId || options.email;

	try {
		posthog.capture({
			distinctId,
			event: options.event,
			properties: {
				form: NEWSLETTER_FORM,
				source: 'api',
				...(sessionId ? { $session_id: sessionId } : {}),
				...(options.reason ? { reason: options.reason } : {})
			}
		});

		if (options.event === NEWSLETTER_SUBSCRIBED_EVENT) {
			if (clientDistinctId && clientDistinctId !== options.email) {
				posthog.alias({
					distinctId: options.email,
					alias: clientDistinctId
				});
			}

			posthog.identify({
				distinctId: options.email,
				properties: {
					email: options.email,
					subscribed_to_build_log: true
				}
			});
		}
	} catch {
		// Analytics must not break the subscribe response.
	} finally {
		await flushPostHogServer();
	}
}

export const POST: APIRoute = async ({ request }) => {
	const origin = request.headers.get('origin');
	if (!origin || origin !== new URL(request.url).origin) {
		return json(false, 403);
	}

	try {
		const verification = await checkBotId();
		if (!verification.isHuman) {
			return json(false, 403);
		}
	} catch {
		// Fail closed so a BotID outage or misconfiguration cannot consume Resend quota.
		return json(false, 503);
	}

	const resendApiKey = getSecret('RESEND_API_KEY')?.trim();
	if (!resendApiKey) {
		return json(false, 503);
	}

	let email: string;
	let company: string;
	try {
		const body: unknown = await request.json();
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			return json(false, 400);
		}
		const record = body as Record<string, unknown>;
		email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
		company = typeof record.company === 'string' ? record.company : '';
	} catch {
		return json(false, 400);
	}

	// Filled honeypot: fake success without contacting Resend or analytics.
	if (company.trim() !== '') {
		return json(true);
	}

	if (!isValidEmail(email)) {
		return json(false, 400);
	}

	const triggered = await triggerBuildLogSubscription(resendApiKey, email);
	if (!triggered.ok) {
		await captureNewsletterEvent({
			request,
			email,
			event: NEWSLETTER_SUBSCRIBE_FAILED_EVENT,
			reason: 'resend_error'
		});
		return json(false, 503);
	}

	await captureNewsletterEvent({
		request,
		email,
		event: NEWSLETTER_SUBSCRIBED_EVENT
	});

	return json(true);
};
