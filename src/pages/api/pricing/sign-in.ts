import type { APIRoute } from 'astro';
import { pricingAuthServer } from '@/lib/pricing/auth-runtime';
import { beginPricingSignIn, pricingAuthFailure } from '@/lib/pricing/auth-server';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, url }) => {
	try {
		const loginUrl = await beginPricingSignIn(await pricingAuthServer(), cookies, url);
		return new Response(null, {
			status: 303,
			headers: { Location: loginUrl, 'Cache-Control': 'no-store' }
		});
	} catch (error) {
		return pricingAuthFailure(error);
	}
};
