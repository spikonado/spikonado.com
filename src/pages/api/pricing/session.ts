import type { APIRoute } from 'astro';
import { pricingAuthServer } from '@/lib/pricing/auth-runtime';
import {
	getPricingSession,
	pricingAuthFailure,
	requirePricingAuthPost
} from '@/lib/pricing/auth-server';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
	try {
		requirePricingAuthPost(request);
		const body = await request.json();
		return Response.json(
			await getPricingSession(await pricingAuthServer(), cookies, url, body?.forceRefresh === true),
			{
				headers: { 'Cache-Control': 'no-store', Vary: 'Cookie, Origin' }
			}
		);
	} catch (error) {
		return pricingAuthFailure(error);
	}
};
