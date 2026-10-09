import type { APIRoute } from 'astro';
import { pricingAuthServer } from '@/lib/pricing/auth-runtime';
import {
	clearPricingAuthCookies,
	endPricingSession,
	pricingAuthFailure,
	requirePricingAuthPost
} from '@/lib/pricing/auth-server';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
	try {
		requirePricingAuthPost(request);
		let result: { logoutUrl: string | null } = { logoutUrl: null };
		try {
			result = await endPricingSession(await pricingAuthServer(), cookies, url);
		} catch {
			// Local sign-out must still work when the billing backend or WorkOS is unavailable.
		} finally {
			clearPricingAuthCookies(cookies, url);
		}
		return Response.json(result, {
			headers: { 'Cache-Control': 'no-store', Vary: 'Cookie, Origin' }
		});
	} catch (error) {
		return pricingAuthFailure(error);
	}
};
