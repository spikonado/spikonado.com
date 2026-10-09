import type { APIRoute } from 'astro';
import { pricingAuthServer } from '@/lib/pricing/auth-runtime';
import { completePricingSignIn } from '@/lib/pricing/auth-server';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, url }) => {
	let target = '/pricing/signed-in';
	try {
		await completePricingSignIn(await pricingAuthServer(), cookies, url);
	} catch {
		target += '?error=sign_in_failed';
	}
	return new Response(null, {
		status: 303,
		headers: {
			Location: target,
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer'
		}
	});
};
