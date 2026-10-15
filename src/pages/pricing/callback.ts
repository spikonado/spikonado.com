import type { APIRoute } from 'astro';
import { pricingAuthServer } from '@/lib/pricing/auth-runtime';
import { completePricingSignIn } from '@/lib/pricing/auth-server';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, url }) => {
	const location = await pricingAuthServer()
		.then((server) => completePricingSignIn(server, cookies, url))
		.catch(() => '/pricing?sign_in=failed');
	return new Response(null, {
		status: 303,
		headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
	});
};
