import type { APIRoute } from 'astro';
import { RESEND_API_KEY } from 'astro:env/server';
import { checkBotId } from 'botid/server';
import { captureServerException, trackServerEvent } from '@/lib/analytics/server';
import { triggerBuildLogSubscription } from '@/lib/build-log/resend';

export const prerender = false;

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Practical shape check - rejects values browsers' type=email would also reject. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
	return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
}

function json(ok: true): Response;
function json(ok: false, status: number): Response;
function json(ok: boolean, status = 200): Response {
	return Response.json(ok ? { ok: true } : { ok: false }, { status, headers: NO_STORE });
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
	} catch (error) {
		captureServerException(error, request, { context: 'newsletter_botid_check' });
		// Fail closed so a BotID outage or misconfiguration cannot consume Resend quota.
		return json(false, 503);
	}

	const resendApiKey = RESEND_API_KEY?.trim();
	if (!resendApiKey) {
		trackServerEvent(request, 'newsletter_subscribe_failed', {
			reason: 'resend_not_configured',
			source: 'server'
		});
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
		trackServerEvent(request, 'newsletter_subscribe_failed', {
			reason: 'resend_error',
			source: 'server'
		});
		return json(false, 503);
	}

	trackServerEvent(request, 'newsletter_subscribed', {}, { email, subscribed_to_build_log: true });
	return json(true);
};
