import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import type { AstroCookies } from 'astro';
import {
	beginPricingSignIn,
	completePricingSignIn,
	createPricingAuthServer,
	endPricingSession,
	getPricingSession,
	pricingAuthFailure,
	PricingAuthError,
	requirePricingAuthPost,
	type PricingAuthServer
} from './auth-server';
import { readSessionCookie, writeSessionCookie } from './session-cookie';

const apiKey = 'sk_test_pricing_auth_no_network';
const cookiePassword = 'pricing-auth-test-only-secret-at-least-32-characters';
const clientId = 'client_pricing_test';
const pricingUrl = new URL('https://spikonado.com/pricing');
const transactionName = '__Host-spikonado-pricing-login';
const refreshToken = 'refresh-token-confidential-test-value';
const publicUser = { id: 'user_pricing_test', email: 'ada@example.com', firstName: 'Ada' };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
	...publicKey.export({ format: 'jwk' }),
	kid: 'pricing-test-key',
	alg: 'RS256',
	use: 'sig'
};
const originalFetch = globalThis.fetch;
const requests: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
let authenticationResponse: () => Response | Promise<Response>;
let server: PricingAuthServer;

function signedToken(claims: Record<string, unknown> = {}) {
	const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
	const payload = Buffer.from(
		JSON.stringify({
			iss: `https://api.workos.com/user_management/${clientId}`,
			sub: publicUser.id,
			sid: 'session_pricing_test',
			exp: Math.floor(Date.now() / 1000) + 300,
			...claims
		})
	).toString('base64url');
	const content = `${header}.${payload}`;
	return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
}

function tokenExpiry(token: string): number {
	return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000;
}

function authResponse(token = signedToken(), rotatedRefreshToken = refreshToken) {
	return Response.json({
		access_token: token,
		refresh_token: rotatedRefreshToken,
		authentication_method: 'MagicAuth',
		user: {
			object: 'user',
			id: publicUser.id,
			email: publicUser.email,
			email_verified: true,
			first_name: publicUser.firstName,
			last_name: 'Lovelace',
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			metadata: { privateNote: 'confidential-user-metadata' }
		}
	});
}

function cookieStore() {
	const values = new Map<string, string>();
	const get = mock((name: string) => {
		const value = values.get(name);
		return value === undefined ? undefined : { value };
	});
	const set = mock<AstroCookies['set']>((name, value) => {
		values.set(name, String(value));
	});
	const remove = mock<AstroCookies['delete']>((name) => {
		values.delete(name);
	});
	const cookies = { get, set, delete: remove } as unknown as Pick<
		AstroCookies,
		'get' | 'set' | 'delete'
	>;
	return { cookies, values, set, remove };
}

async function seedSession(store: ReturnType<typeof cookieStore>, token = signedToken()) {
	authenticationResponse = () => authResponse(token);
	const response = await server.workos.userManagement.authenticateWithCode({
		code: 'fixture-code',
		codeVerifier: 'v'.repeat(43),
		session: { sealSession: true, cookiePassword }
	});
	expect(response.sealedSession).toBeString();
	writeSessionCookie(store.cookies, pricingUrl, response.sealedSession!);
	requests.length = 0;
	store.set.mockClear();
	store.remove.mockClear();
	return response.sealedSession!;
}

async function startLogin(store: ReturnType<typeof cookieStore>) {
	const authorizationUrl = new URL(await beginPricingSignIn(server, store.cookies, pricingUrl));
	const callback = new URL('/pricing/callback', pricingUrl);
	callback.searchParams.set('code', 'authorization-code');
	callback.searchParams.set('state', authorizationUrl.searchParams.get('state')!);
	return { authorizationUrl, callback };
}

function authRequest(headers: Record<string, string>) {
	const request = new Request('https://spikonado.com/api/pricing/session', { method: 'POST' });
	// Happy DOM removes browser-controlled headers passed to the Request constructor.
	for (const [name, value] of Object.entries(headers)) request.headers.set(name, value);
	return request;
}

beforeEach(() => {
	requests.length = 0;
	authenticationResponse = () => authResponse();
	globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		const method = init?.method ?? 'GET';
		const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
		requests.push({ url, method, body });
		if (url === `https://api.workos.com/sso/jwks/${clientId}` && method === 'GET') {
			return Response.json({ keys: [jwk] });
		}
		if (url === 'https://api.workos.com/user_management/authenticate' && method === 'POST') {
			return authenticationResponse();
		}
		throw new Error(`Unexpected network request: ${method} ${url}`);
	}) as unknown as typeof fetch;
	server = createPricingAuthServer(apiKey, cookiePassword, clientId);
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	mock.restore();
});

describe('pricing sign-in', () => {
	test.each([
		[undefined, cookiePassword, clientId],
		['   ', cookiePassword, clientId],
		[apiKey, undefined, clientId],
		[apiKey, 'short-secret', clientId],
		[apiKey, cookiePassword, '   ']
	])('reports missing server configuration, case %#', (key, password, id) => {
		expect(() => createPricingAuthServer(key, password, id!)).toThrow(PricingAuthError);
	});

	test('uses PKCE and consumes the signed transaction before exchanging the code', async () => {
		const store = cookieStore();
		const { authorizationUrl, callback } = await startLogin(store);
		const raw = store.values.get(transactionName)!;
		const transaction = JSON.parse(Buffer.from(raw.split('.')[0], 'base64url').toString());
		expect(authorizationUrl.origin).toBe('https://api.workos.com');
		expect(authorizationUrl.pathname).toBe('/user_management/authorize');
		expect(authorizationUrl.searchParams.get('provider')).toBe('authkit');
		expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
			'https://spikonado.com/pricing/callback'
		);
		expect(authorizationUrl.searchParams.get('client_id')).toBe(clientId);
		expect(authorizationUrl.searchParams.get('state')).toBe(transaction.state);
		expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
		expect(authorizationUrl.searchParams.get('code_challenge')).toBe(
			createHash('sha256').update(transaction.codeVerifier).digest('base64url')
		);
		expect(store.set.mock.calls[0]).toEqual([
			transactionName,
			raw,
			{ path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 }
		]);
		const token = signedToken();
		authenticationResponse = () => {
			expect(store.values.has(transactionName)).toBe(false);
			expect(store.remove).toHaveBeenCalledWith(transactionName, {
				path: '/',
				httpOnly: true,
				secure: true,
				sameSite: 'lax'
			});
			return authResponse(token);
		};
		await completePricingSignIn(server, store.cookies, callback);
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toEqual({
			grant_type: 'authorization_code',
			client_id: clientId,
			client_secret: apiKey,
			code: 'authorization-code',
			code_verifier: transaction.codeVerifier
		});
		const sealedSession = readSessionCookie(store.cookies, pricingUrl)!;
		for (const secret of [
			refreshToken,
			publicUser.email,
			publicUser.id,
			'confidential-user-metadata',
			token
		]) {
			expect(sealedSession).not.toContain(secret);
		}
		expect(
			await server.workos.userManagement.getSessionFromCookie({
				sessionData: sealedSession,
				cookiePassword
			})
		).toMatchObject({ accessToken: token, refreshToken, user: publicUser });
		expect(await getPricingSession(server, store.cookies, pricingUrl, false)).toEqual({
			user: publicUser,
			accessToken: token,
			expiresAt: tokenExpiry(token)
		});
		expect(requests[1]).toMatchObject({
			method: 'GET',
			url: `https://api.workos.com/sso/jwks/${clientId}`
		});
		await expect(completePricingSignIn(server, store.cookies, callback)).rejects.toMatchObject({
			status: 400
		});
		expect(requests).toHaveLength(2);
	});

	test.each([
		'missing transaction',
		'missing code',
		'missing state',
		'wrong state',
		'tampered transaction',
		'expired transaction',
		'different origin',
		'different client',
		'provider error'
	])('rejects and consumes the callback with %s before exchanging a code', async (scenario) => {
		const store = cookieStore();
		const { callback } = await startLogin(store);
		let callbackServer = server;
		if (scenario === 'missing transaction') store.values.delete(transactionName);
		if (scenario === 'missing code') callback.searchParams.delete('code');
		if (scenario === 'missing state') callback.searchParams.delete('state');
		if (scenario === 'wrong state') callback.searchParams.set('state', 'different-state');
		if (scenario === 'tampered transaction')
			store.values.set(transactionName, `${store.values.get(transactionName)}tampered`);
		if (scenario === 'expired transaction')
			spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001);
		if (scenario === 'different origin') callback.hostname = 'other.example.com';
		if (scenario === 'different client')
			callbackServer = createPricingAuthServer(apiKey, cookiePassword, 'other-client');
		if (scenario === 'provider error') callback.searchParams.set('error', 'access_denied');
		await expect(
			completePricingSignIn(callbackServer, store.cookies, callback)
		).rejects.toMatchObject({ status: 400 });
		expect(store.values.has(transactionName)).toBe(false);
		expect(requests).toHaveLength(0);
	});

	test('requires HTTPS before starting a login outside localhost', async () => {
		const store = cookieStore();
		await expect(
			beginPricingSignIn(server, store.cookies, new URL('http://spikonado.com/pricing'))
		).rejects.toThrow('requires HTTPS');
		expect(store.values.size).toBe(0);
	});

	test('consumes the transaction even when the code exchange is unavailable', async () => {
		const store = cookieStore();
		const { callback } = await startLogin(store);
		authenticationResponse = () => Response.json({ message: 'Unavailable' }, { status: 503 });
		await expect(completePricingSignIn(server, store.cookies, callback)).rejects.toThrow();
		expect(store.values.size).toBe(0);
		await expect(completePricingSignIn(server, store.cookies, callback)).rejects.toMatchObject({
			status: 400
		});
		expect(requests).toHaveLength(1);
	});
});

describe('pricing sessions', () => {
	test('returns a signed-out session when no cookie exists', async () => {
		const store = cookieStore();
		expect(await getPricingSession(server, store.cookies, pricingUrl, false)).toEqual({
			user: null,
			accessToken: null,
			expiresAt: null
		});
		expect(requests).toHaveLength(0);
	});

	test('returns only the short-lived token, public user fields and expiry from a valid signed session', async () => {
		const store = cookieStore();
		const token = signedToken();
		const seal = await seedSession(store, token);
		expect(await getPricingSession(server, store.cookies, pricingUrl, false)).toEqual({
			user: publicUser,
			accessToken: token,
			expiresAt: tokenExpiry(token)
		});
		expect(readSessionCookie(store.cookies, pricingUrl)).toBe(seal);
		expect(store.set).not.toHaveBeenCalled();
		expect(requests.map(({ method }) => method)).toEqual(['GET']);
	});

	test('verifies the JWT signature against JWKS and refreshes an invalid signature', async () => {
		const store = cookieStore();
		const parts = signedToken().split('.');
		const signature = Buffer.from(parts[2], 'base64url');
		signature[0] ^= 1;
		parts[2] = signature.toString('base64url');
		await seedSession(store, parts.join('.'));
		const token = signedToken({ exp: Math.floor(Date.now() / 1000) + 600 });
		authenticationResponse = () => authResponse(token, 'rotated-refresh-token');
		expect(await getPricingSession(server, store.cookies, pricingUrl, false)).toEqual({
			user: publicUser,
			accessToken: token,
			expiresAt: tokenExpiry(token)
		});
		expect(requests.map(({ method }) => method)).toEqual(['GET', 'POST']);
		expect(requests[1].body).toMatchObject({
			grant_type: 'refresh_token',
			refresh_token: refreshToken
		});
	});

	test.each(['forced', 'near expiry', 'expired'])(
		'rotates and persists the real encrypted session on %s refresh',
		async (scenario) => {
			const store = cookieStore();
			const oldToken = signedToken({
				exp:
					Math.floor(Date.now() / 1000) +
					(scenario === 'expired' ? -300 : scenario === 'near expiry' ? 30 : 300)
			});
			const oldSeal = await seedSession(store, oldToken);
			const newToken = signedToken({ exp: Math.floor(Date.now() / 1000) + 600 });
			authenticationResponse = () => authResponse(newToken, 'rotated-confidential-refresh-token');
			expect(
				await getPricingSession(server, store.cookies, pricingUrl, scenario === 'forced')
			).toEqual({
				user: publicUser,
				accessToken: newToken,
				expiresAt: tokenExpiry(newToken)
			});
			expect(requests.filter(({ method }) => method === 'POST').map(({ body }) => body)).toEqual([
				{
					grant_type: 'refresh_token',
					client_id: clientId,
					client_secret: apiKey,
					refresh_token: refreshToken
				}
			]);
			const newSeal = readSessionCookie(store.cookies, pricingUrl)!;
			expect(newSeal).not.toBe(oldSeal);
			expect(
				await server.workos.userManagement.getSessionFromCookie({
					sessionData: newSeal,
					cookiePassword
				})
			).toMatchObject({
				accessToken: newToken,
				refreshToken: 'rotated-confidential-refresh-token'
			});
			requests.length = 0;
			expect(await getPricingSession(server, store.cookies, pricingUrl, false)).toMatchObject({
				accessToken: newToken
			});
			expect(requests).toHaveLength(0);
		}
	);

	test.each(['server error', 'rate limit', 'network failure'])(
		'preserves the session and reports an unavailable error after a refresh %s',
		async (scenario) => {
			const store = cookieStore();
			const seal = await seedSession(store);
			const cookiesBefore = [...store.values];
			authenticationResponse = () => {
				if (scenario === 'network failure') throw new TypeError('fetch failed');
				return Response.json(
					{ message: 'WorkOS temporarily unavailable' },
					{ status: scenario === 'rate limit' ? 429 : 503 }
				);
			};
			await expect(
				getPricingSession(server, store.cookies, pricingUrl, true)
			).rejects.toMatchObject({
				status: 503,
				message: 'Sign-in is temporarily unavailable. Check your connection and try again.'
			});
			expect(readSessionCookie(store.cookies, pricingUrl)).toBe(seal);
			expect([...store.values]).toEqual(cookiesBefore);
			expect(store.set).not.toHaveBeenCalled();
			expect(store.remove).not.toHaveBeenCalled();
			expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
		}
	);

	test('clears a revoked refresh session and returns signed out', async () => {
		const store = cookieStore();
		await seedSession(store);
		authenticationResponse = () =>
			Response.json(
				{ error: 'invalid_grant', error_description: 'Session revoked' },
				{ status: 400 }
			);
		expect(await getPricingSession(server, store.cookies, pricingUrl, true)).toEqual({
			user: null,
			accessToken: null,
			expiresAt: null
		});
		expect(store.values.size).toBe(0);
	});

	test('clears an invalid sealed cookie and returns signed out', async () => {
		const store = cookieStore();
		writeSessionCookie(store.cookies, pricingUrl, 'invalid-sealed-session');
		expect(await getPricingSession(server, store.cookies, pricingUrl, false)).toEqual({
			user: null,
			accessToken: null,
			expiresAt: null
		});
		expect(store.values.size).toBe(0);
		expect(requests).toHaveLength(0);
	});

	test('signs out an expired access token without refreshing and returns the WorkOS logout URL', async () => {
		const store = cookieStore();
		await seedSession(store, signedToken({ exp: Math.floor(Date.now() / 1000) - 300 }));
		await startLogin(store);
		const result = await endPricingSession(server, store.cookies, pricingUrl);
		const logoutUrl = new URL(result.logoutUrl!);
		expect(logoutUrl.origin).toBe('https://api.workos.com');
		expect(logoutUrl.pathname).toBe('/user_management/sessions/logout');
		expect(logoutUrl.searchParams.get('session_id')).toBe('session_pricing_test');
		expect(logoutUrl.searchParams.get('return_to')).toBe('https://spikonado.com/pricing');
		expect(store.values.size).toBe(0);
		expect(requests).toHaveLength(0);
	});
});

describe('pricing auth request protection', () => {
	test('accepts same-origin requests with the custom auth header', () => {
		expect(() =>
			requirePricingAuthPost(
				authRequest({
					Origin: pricingUrl.origin,
					'X-Pricing-Auth': '1',
					'Sec-Fetch-Site': 'same-origin'
				})
			)
		).not.toThrow();
	});

	test.each([
		{ Origin: 'https://attacker.example', 'X-Pricing-Auth': '1' },
		{ Origin: pricingUrl.origin, 'X-Pricing-Auth': '1', 'Sec-Fetch-Site': 'cross-site' },
		{ Origin: pricingUrl.origin },
		{ 'X-Pricing-Auth': '1' },
		{ Origin: pricingUrl.origin, 'X-Pricing-Auth': '0' }
	] as Record<string, string>[])(
		'rejects cross-site or incomplete requests, case %#',
		(headers) => {
			expect(() => requirePricingAuthPost(authRequest(headers))).toThrow(
				expect.objectContaining({ status: 403 })
			);
		}
	);

	test('returns safe, uncached errors while preserving intentional auth statuses', async () => {
		const failure = pricingAuthFailure(new Error(`internal secret: ${apiKey}`));
		expect(failure.status).toBe(503);
		expect(failure.headers.get('cache-control')).toBe('no-store');
		expect(failure.headers.get('vary')).toBe('Cookie, Origin');
		expect(await failure.json()).toEqual({
			error: 'Sign-in is temporarily unavailable. Try again.'
		});
		const forbidden = pricingAuthFailure(
			new PricingAuthError('This sign-in request is not allowed.', 403)
		);
		expect(forbidden.status).toBe(403);
		expect(await forbidden.json()).toEqual({ error: 'This sign-in request is not allowed.' });
	});
});
