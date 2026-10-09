import { expect, test } from 'bun:test';
import { createClient } from '@workos-inc/authkit-js';
import type { Window as HappyWindow } from 'happy-dom';
import { pricingAuthOptions } from './auth-config.ts';

test('explicit development auth restores the user after callback page teardown', async () => {
	const happyDOM = (window as unknown as HappyWindow).happyDOM;
	const originalUrl = window.location.href;
	const originalFetch = globalThis.fetch;
	const navigatorPrototype = Object.getPrototypeOf(navigator);
	const originalLocks = Object.getOwnPropertyDescriptor(navigatorPrototype, 'locks');
	const clientId = 'client_pricing_session_test';
	const redirectUri = 'https://preview.vercel.app/pricing/callback';
	const issuedAt = Math.floor(Date.now() / 1000);
	const accessToken = [
		Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
		Buffer.from(
			JSON.stringify({
				sub: 'user_pricing_session_test',
				sid: 'session_pricing_test',
				iat: issuedAt,
				exp: issuedAt + 3600
			})
		).toString('base64url'),
		Buffer.from('synthetic-signature').toString('base64url')
	].join('.');
	const authentication = {
		user: {
			object: 'user',
			id: 'user_pricing_session_test',
			email: 'pricing-session@example.com',
			email_verified: true,
			first_name: 'Pricing',
			last_name: 'Test',
			profile_picture_url: null,
			last_sign_in_at: null,
			external_id: null,
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z'
		},
		access_token: accessToken,
		refresh_token: 'synthetic-refresh-token',
		authentication_method: 'Password'
	};
	const requests: { url: string; method?: string; body: Record<string, unknown> }[] = [];
	let callbackClient: Awaited<ReturnType<typeof createClient>> | undefined;
	let pricingClient: Awaited<ReturnType<typeof createClient>> | undefined;

	try {
		// Happy DOM's null Web Locks placeholder prevents the SDK's real fallback.
		if (navigator.locks === null) Reflect.deleteProperty(navigatorPrototype, 'locks');
		happyDOM.setURL(`${redirectUri}?code=synthetic-code`);
		window.localStorage.clear();
		window.sessionStorage.clear();
		window.sessionStorage.setItem('workos:code-verifier', 'synthetic-code-verifier');
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			requests.push({
				url: String(input),
				method: init?.method,
				body: JSON.parse(String(init?.body))
			});
			return Response.json(authentication);
		}) as typeof fetch;
		const options = {
			...pricingAuthOptions('true', undefined, 'preview.vercel.app'),
			redirectUri
		};

		callbackClient = await createClient(clientId, options);
		const authenticatedUser = callbackClient.getUser();
		expect(authenticatedUser).toMatchObject({
			id: authentication.user.id,
			email: authentication.user.email
		});

		// A full navigation loses SDK memory but keeps browser storage.
		callbackClient.dispose();
		expect(callbackClient.getUser()).toBeNull();
		window.history.replaceState({}, '', '/pricing');
		pricingClient = await createClient(clientId, options);

		expect(pricingClient.getUser()).toEqual(authenticatedUser);
		expect(await pricingClient.getAccessToken()).toBe(accessToken);
		expect(requests).toEqual([
			{
				url: 'https://api.workos.com/user_management/authenticate',
				method: 'POST',
				body: {
					client_id: clientId,
					grant_type: 'authorization_code',
					code: 'synthetic-code',
					code_verifier: 'synthetic-code-verifier'
				}
			},
			{
				url: 'https://api.workos.com/user_management/authenticate',
				method: 'POST',
				body: {
					client_id: clientId,
					grant_type: 'refresh_token',
					refresh_token: authentication.refresh_token
				}
			}
		]);
	} finally {
		callbackClient?.dispose();
		pricingClient?.dispose();
		globalThis.fetch = originalFetch;
		if (originalLocks) Object.defineProperty(navigatorPrototype, 'locks', originalLocks);
		await happyDOM.abort();
		window.localStorage.clear();
		window.sessionStorage.clear();
		happyDOM.setURL(originalUrl);
	}
});
