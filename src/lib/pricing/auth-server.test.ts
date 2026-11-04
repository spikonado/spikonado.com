import { expect, mock, test } from 'bun:test';
import type { AstroCookies } from 'astro';
import {
	beginPricingSignIn,
	completePricingSignIn,
	getPricingSession,
	pricingLogoutUrl,
	type PricingAuthServer
} from './auth-server';

function fakeCookies() {
	const jar = new Map<string, string>();
	const cookies = {
		get: (name: string) => {
			const value = jar.get(name);
			return value === undefined ? undefined : { value, json: () => JSON.parse(value) };
		},
		set: (name: string, value: string | object) =>
			jar.set(name, typeof value === 'string' ? value : JSON.stringify(value)),
		delete: (name: string) => jar.delete(name)
	} as unknown as Pick<AstroCookies, 'get' | 'set' | 'delete'>;
	return { jar, cookies };
}

function fakeServer() {
	const authenticateWithCode = mock(async () => ({ sealedSession: 'sealed-session' }));
	const server = {
		cookiePassword: 'x'.repeat(32),
		workos: {
			userManagement: {
				getAuthorizationUrlWithPKCE: async () => ({
					url: 'https://api.workos.com/authorize',
					state: 'state-1',
					codeVerifier: 'verifier-1'
				}),
				authenticateWithCode
			}
		}
	} as unknown as PricingAuthServer;
	return { server, authenticateWithCode };
}

test('sign-in returns to the plan chosen before signing in', async () => {
	const { server, authenticateWithCode } = fakeServer();
	const { jar, cookies } = fakeCookies();

	await beginPricingSignIn(
		server,
		cookies,
		new URL('https://spikonado.com/api/pricing/sign-in?tier=pro&interval=annual')
	);
	const returnTo = await completePricingSignIn(
		server,
		cookies,
		new URL('https://spikonado.com/pricing/callback?code=code-1&state=state-1')
	);

	expect(returnTo).toBe('/pricing?checkout=resume&tier=pro&interval=annual');
	expect(authenticateWithCode).toHaveBeenCalledWith(
		expect.objectContaining({ code: 'code-1', codeVerifier: 'verifier-1' })
	);
	expect(jar.get('__Host-spikonado-pricing-session')).toBe('sealed-session');
	expect(jar.has('__Host-spikonado-pricing-login')).toBe(false);
});

test('sign-in completion requires the state issued to this browser', async () => {
	const { server, authenticateWithCode } = fakeServer();
	const { cookies } = fakeCookies();

	await beginPricingSignIn(server, cookies, new URL('https://spikonado.com/api/pricing/sign-in'));
	await expect(
		completePricingSignIn(
			server,
			cookies,
			new URL('https://spikonado.com/pricing/callback?code=code-1&state=other')
		)
	).rejects.toThrow('Sign-in could not be completed.');
	expect(authenticateWithCode).not.toHaveBeenCalled();
});

function unsignedJwt(claims: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
	const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
	return `${header}.${payload}.sig`;
}

test('session expiry comes from a verified access token', async () => {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const accessToken = unsignedJwt({ exp, sid: 'session-1' });
	const verifyAccessToken = mock(async () => ({ exp, sid: 'session-1' }));
	const server = {
		cookiePassword: 'x'.repeat(32),
		workos: {
			userManagement: {
				loadSealedSession: () => ({
					authenticate: async () => ({
						authenticated: true,
						user: { id: 'user_1', email: 'ada@spikonado.com' },
						accessToken
					}),
					refresh: async () => ({ authenticated: false })
				}),
				verifyAccessToken
			}
		}
	} as unknown as PricingAuthServer;
	const { cookies } = fakeCookies();
	cookies.set('__Host-spikonado-pricing-session', 'sealed-session');

	const session = await getPricingSession(
		server,
		cookies,
		new URL('https://spikonado.com/api/pricing/session')
	);

	expect(verifyAccessToken).toHaveBeenCalledWith(accessToken);
	expect(session.user).toEqual({ id: 'user_1', email: 'ada@spikonado.com' });
	expect(session.accessToken).toBe(accessToken);
	expect(session.expiresAt).toBe(exp * 1000);
});

test('logout uses the verified session ID when the access token is still valid', async () => {
	const accessToken = unsignedJwt({ exp: Math.floor(Date.now() / 1000) + 3600, sid: 'session-1' });
	const verifyAccessToken = mock(async () => ({ sid: 'session-1' }));
	const getLogoutUrl = mock(() => 'https://api.workos.com/user_management/sessions/logout');
	const server = {
		cookiePassword: 'x'.repeat(32),
		workos: {
			userManagement: {
				getSessionFromCookie: async () => ({ accessToken }),
				verifyAccessToken,
				getLogoutUrl
			}
		}
	} as unknown as PricingAuthServer;

	const logoutUrl = await pricingLogoutUrl(
		server,
		'sealed-session',
		new URL('https://spikonado.com/api/pricing/sign-out')
	);

	expect(verifyAccessToken).toHaveBeenCalledWith(accessToken);
	expect(getLogoutUrl).toHaveBeenCalledWith({
		sessionId: 'session-1',
		returnTo: 'https://spikonado.com/pricing'
	});
	expect(logoutUrl).toBe('https://api.workos.com/user_management/sessions/logout');
});

test('logout still reads the session ID after the access token expires', async () => {
	const accessToken = unsignedJwt({
		exp: Math.floor(Date.now() / 1000) - 60,
		sid: 'session-expired'
	});
	const verifyAccessToken = mock(async () => null);
	const getLogoutUrl = mock(() => 'https://api.workos.com/user_management/sessions/logout');
	const server = {
		cookiePassword: 'x'.repeat(32),
		workos: {
			userManagement: {
				getSessionFromCookie: async () => ({ accessToken }),
				verifyAccessToken,
				getLogoutUrl
			}
		}
	} as unknown as PricingAuthServer;

	const logoutUrl = await pricingLogoutUrl(
		server,
		'sealed-session',
		new URL('https://spikonado.com/api/pricing/sign-out')
	);

	expect(verifyAccessToken).toHaveBeenCalledWith(accessToken);
	expect(getLogoutUrl).toHaveBeenCalledWith({
		sessionId: 'session-expired',
		returnTo: 'https://spikonado.com/pricing'
	});
	expect(logoutUrl).toBe('https://api.workos.com/user_management/sessions/logout');
});
