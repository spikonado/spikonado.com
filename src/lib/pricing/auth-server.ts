import { createHmac, timingSafeEqual } from 'node:crypto';
import { WorkOS, type User } from '@workos-inc/node';
import type { AstroCookies } from 'astro';
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from './session-cookie';

type Cookies = Pick<AstroCookies, 'get' | 'set' | 'delete'>;
export type PricingAuthServer = { workos: WorkOS; cookiePassword: string; clientId: string };

export class PricingAuthError extends Error {
	constructor(
		message: string,
		public status = 503
	) {
		super(message);
	}
}

export function createPricingAuthServer(
	apiKey: string | undefined,
	cookiePassword: string | undefined,
	clientId: string
): PricingAuthServer {
	if (!apiKey?.trim())
		throw new PricingAuthError('Sign-in is not configured (missing WORKOS_API_KEY).');
	if (!cookiePassword || cookiePassword.length < 32) {
		throw new PricingAuthError('Sign-in needs WORKOS_COOKIE_PASSWORD with at least 32 characters.');
	}
	if (!clientId.trim())
		throw new PricingAuthError('Sign-in is not configured in the billing backend.');
	return {
		cookiePassword,
		clientId,
		workos: new WorkOS(apiKey.trim(), {
			clientId,
			issuer: ['https://api.workos.com/', `https://api.workos.com/user_management/${clientId}`],
			timeout: 8_000,
			maxRetries: 0
		})
	};
}

function transactionCookie(url: URL): string {
	return url.protocol === 'https:' ? '__Host-spikonado-pricing-login' : 'spikonado-pricing-login';
}

function cookieOptions(url: URL) {
	if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
		throw new PricingAuthError('Sign-in requires HTTPS.');
	}
	return { path: '/', httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax' as const };
}

function signTransaction(value: string, password: string): string {
	return createHmac('sha256', password).update(value).digest('base64url');
}

export async function beginPricingSignIn(server: PricingAuthServer, cookies: Cookies, url: URL) {
	const options = cookieOptions(url);
	const login = await server.workos.userManagement.getAuthorizationUrlWithPKCE({
		provider: 'authkit',
		redirectUri: `${url.origin}/pricing/callback`
	});
	const value = Buffer.from(
		JSON.stringify({
			state: login.state,
			codeVerifier: login.codeVerifier,
			origin: url.origin,
			clientId: server.clientId,
			expiresAt: Date.now() + 600_000
		})
	).toString('base64url');
	cookies.set(transactionCookie(url), `${value}.${signTransaction(value, server.cookiePassword)}`, {
		...options,
		maxAge: 600
	});
	return login.url;
}

export async function completePricingSignIn(server: PricingAuthServer, cookies: Cookies, url: URL) {
	const name = transactionCookie(url);
	const raw = cookies.get(name)?.value;
	cookies.delete(name, cookieOptions(url));
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (url.searchParams.has('error') || !raw || !code || !state || raw.length > 2_000) {
		throw new PricingAuthError(
			'Sign-in could not be completed. Return to pricing and try again.',
			400
		);
	}
	const [value, signature] = raw.split('.');
	const expected = signTransaction(value, server.cookiePassword);
	if (
		!signature ||
		signature.length !== expected.length ||
		!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
	) {
		throw new PricingAuthError(
			'This sign-in request is invalid. Return to pricing and try again.',
			400
		);
	}
	let transaction;
	try {
		transaction = JSON.parse(Buffer.from(value, 'base64url').toString()) as Record<string, unknown>;
	} catch {
		throw new PricingAuthError(
			'This sign-in request is invalid. Return to pricing and try again.',
			400
		);
	}
	if (
		transaction.state !== state ||
		transaction.origin !== url.origin ||
		transaction.clientId !== server.clientId ||
		typeof transaction.codeVerifier !== 'string' ||
		typeof transaction.expiresAt !== 'number' ||
		transaction.expiresAt <= Date.now()
	) {
		throw new PricingAuthError(
			'This sign-in request expired or changed. Return to pricing and try again.',
			400
		);
	}
	const result = await server.workos.userManagement.authenticateWithCode({
		code,
		codeVerifier: transaction.codeVerifier,
		session: { sealSession: true, cookiePassword: server.cookiePassword }
	});
	if (!result.sealedSession)
		throw new PricingAuthError('Sign-in did not return a session. Try again.');
	accessTokenClaims(result.accessToken, result.user, server.clientId);
	writeSessionCookie(cookies, url, result.sealedSession);
}

function accessTokenClaims(
	token: string,
	user: User,
	clientId: string
): { exp: number; sid: string } {
	try {
		const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
		const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
		if (
			header.alg !== 'RS256' ||
			claims.sub !== user.id ||
			typeof claims.sid !== 'string' ||
			!claims.sid ||
			!Number.isFinite(claims.exp) ||
			claims.exp <= Date.now() / 1000 ||
			!(
				claims.iss === `https://api.workos.com/user_management/${clientId}` ||
				(claims.iss === 'https://api.workos.com/' &&
					(claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId))))
			)
		)
			throw new Error();
		return claims;
	} catch {
		throw new PricingAuthError('Sign-in returned an invalid access token. Try again.');
	}
}

const signedOut = { user: null, accessToken: null, expiresAt: null };

export async function getPricingSession(
	server: PricingAuthServer,
	cookies: Cookies,
	url: URL,
	forceRefresh: boolean
) {
	const sealedSession = readSessionCookie(cookies, url);
	if (!sealedSession) return signedOut;
	const session = server.workos.userManagement.loadSealedSession({
		sessionData: sealedSession,
		cookiePassword: server.cookiePassword
	});
	const authenticated = await session.authenticate();
	if (!authenticated.authenticated && authenticated.reason !== 'invalid_jwt') {
		clearSessionCookie(cookies, url);
		return signedOut;
	}
	let token: string;
	let user: User;
	if (
		authenticated.authenticated &&
		!forceRefresh &&
		accessTokenClaims(authenticated.accessToken, authenticated.user, server.clientId).exp * 1000 >
			Date.now() + 60_000
	) {
		token = authenticated.accessToken;
		user = authenticated.user;
	} else {
		const refreshed = await session.refresh();
		if (!refreshed.authenticated) {
			if (refreshed.retryable) {
				throw new PricingAuthError(
					'Sign-in is temporarily unavailable. Check your connection and try again.'
				);
			}
			clearSessionCookie(cookies, url);
			return signedOut;
		}
		if (!refreshed.session || !refreshed.sealedSession) {
			throw new PricingAuthError('Sign-in could not be refreshed. Try again.');
		}
		token = refreshed.session.accessToken;
		user = refreshed.user;
		accessTokenClaims(token, user, server.clientId);
		writeSessionCookie(cookies, url, refreshed.sealedSession);
	}
	const claims = accessTokenClaims(token, user, server.clientId);
	return {
		user: { id: user.id, email: user.email, firstName: user.firstName },
		accessToken: token,
		expiresAt: claims.exp * 1000
	};
}

export async function endPricingSession(server: PricingAuthServer, cookies: Cookies, url: URL) {
	const sealedSession = readSessionCookie(cookies, url);
	clearPricingAuthCookies(cookies, url);
	let logoutUrl: string | null = null;
	if (sealedSession) {
		// Unsealing is sufficient for logout, including when the access token expired.
		const session = await server.workos.userManagement.getSessionFromCookie({
			sessionData: sealedSession,
			cookiePassword: server.cookiePassword
		});
		if (session?.accessToken) {
			const claims = JSON.parse(
				Buffer.from(session.accessToken.split('.')[1], 'base64url').toString()
			);
			if (typeof claims.sid === 'string' && claims.sid) {
				logoutUrl = server.workos.userManagement.getLogoutUrl({
					sessionId: claims.sid,
					returnTo: `${url.origin}/pricing`
				});
			}
		}
	}
	return { logoutUrl };
}

export function clearPricingAuthCookies(cookies: Cookies, url: URL): void {
	clearSessionCookie(cookies, url);
	cookies.delete(transactionCookie(url), cookieOptions(url));
}

export function requirePricingAuthPost(request: Request): void {
	if (
		request.headers.get('origin') !== new URL(request.url).origin ||
		request.headers.get('x-pricing-auth') !== '1' ||
		request.headers.get('sec-fetch-site') === 'cross-site'
	) {
		throw new PricingAuthError('This sign-in request is not allowed.', 403);
	}
}

export function pricingAuthFailure(error: unknown): Response {
	return Response.json(
		{
			error:
				error instanceof PricingAuthError
					? error.message
					: 'Sign-in is temporarily unavailable. Try again.'
		},
		{
			status: error instanceof PricingAuthError ? error.status : 503,
			headers: { 'Cache-Control': 'no-store', Vary: 'Cookie, Origin' }
		}
	);
}
