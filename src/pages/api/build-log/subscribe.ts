import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { triggerBuildLogSubscription } from '@/lib/build-log/resend';

export const prerender = false;

const NO_STORE = { 'Cache-Control': 'no-store' };

function json(ok: true): Response;
function json(ok: false, status: number): Response;
function json(ok: boolean, status = 200): Response {
	return Response.json(ok ? { ok: true } : { ok: false }, { status, headers: NO_STORE });
}

export const POST: APIRoute = async ({ request }) => {
	const origin = request.headers.get('origin');
	if (origin && origin !== new URL(request.url).origin) {
		return json(false, 403);
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

	// Filled honeypot: fake success without contacting Resend.
	if (company.trim() !== '') {
		return json(true);
	}

	if (!email) {
		return json(false, 400);
	}

	const triggered = await triggerBuildLogSubscription(resendApiKey, email);
	if (!triggered.ok) {
		return json(false, 503);
	}

	return json(true);
};
