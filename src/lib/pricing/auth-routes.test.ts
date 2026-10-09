import { afterEach, expect, mock, test } from 'bun:test';
import type { APIContext, AstroCookies } from 'astro';

mock.module('@/lib/pricing/auth-runtime', () => ({
	pricingAuthServer: async () => {
		throw new Error('Backend unavailable with private details');
	}
}));

const { POST: signOut } = await import('@/pages/api/pricing/sign-out');
const { POST: session } = await import('@/pages/api/pricing/session');
const { GET: callback } = await import('@/pages/pricing/callback');

afterEach(() => mock.clearAllMocks());

function context(path: string, origin = 'https://spikonado.com'): APIContext {
	const url = new URL(path, 'https://spikonado.com');
	const request = new Request(url, { method: 'POST', body: '{}' });
	request.headers.set('Origin', origin);
	request.headers.set('X-Pricing-Auth', '1');
	const cookies = {
		get: () => undefined,
		set: mock(() => {}),
		delete: mock(() => {})
	} as unknown as AstroCookies;
	return { request, url, cookies } as APIContext;
}

test('sign-out clears local cookies when the backend cannot initialize', async () => {
	const ctx = context('/api/pricing/sign-out');
	const response = await signOut(ctx);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ logoutUrl: null });
	expect(response.headers.get('Cache-Control')).toBe('no-store');
	expect(ctx.cookies.delete).toHaveBeenCalledWith('__Host-spikonado-pricing-session', {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax'
	});
	expect(ctx.cookies.delete).toHaveBeenCalledWith('__Host-spikonado-pricing-login', {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax'
	});
});

test('a cross-site sign-out does not clear cookies', async () => {
	const ctx = context('/api/pricing/sign-out', 'https://untrusted.example');
	const response = await signOut(ctx);
	expect(response.status).toBe(403);
	expect(ctx.cookies.delete).toHaveBeenCalledTimes(0);
});

test('an unavailable session returns a safe uncached error', async () => {
	const response = await session(context('/api/pricing/session'));
	expect(response.status).toBe(503);
	expect(response.headers.get('Cache-Control')).toBe('no-store');
	expect(await response.json()).toEqual({
		error: 'Sign-in is temporarily unavailable. Try again.'
	});
});

test('a failed callback removes codes from the URL and does not restart sign-in', async () => {
	const response = await callback(
		context('/pricing/callback?code=private-code&state=private-state')
	);
	expect(response.status).toBe(303);
	expect(response.headers.get('Location')).toBe('/pricing/signed-in?error=sign_in_failed');
	expect(response.headers.get('Cache-Control')).toBe('no-store');
	expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
});
