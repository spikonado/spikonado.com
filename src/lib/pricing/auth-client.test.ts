import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import {
	createPricingAuthClient,
	signOutPricingSession,
	type PricingAuthClient,
	type PricingUser
} from './auth-client';

const originalFetch = globalThis.fetch;
const user: PricingUser = { id: 'user-a', email: 'a@example.com', firstName: 'Ada' };
const requests: { path: string; init: RequestInit }[] = [];
let fetchBehavior: () => Promise<Response>;
let client: PricingAuthClient | undefined;

function session(accessToken = 'opaque-access-token', expiresAt = Date.now() + 300_000): Response {
	return Response.json({ user, accessToken, expiresAt });
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	requests.length = 0;
	client = undefined;
	fetchBehavior = async () => session();
	globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
		requests.push({ path: String(input), init: init ?? {} });
		return fetchBehavior();
	}) as unknown as typeof fetch;
});

afterEach(() => {
	client?.dispose();
	globalThis.fetch = originalFetch;
	mock.restore();
});

describe('pricing server session initialization', () => {
	test('removes refresh tokens left by the previous browser integration', async () => {
		window.localStorage.setItem('workos:refresh-token:client_previous', 'previous-token');
		window.localStorage.setItem('workos:refresh-token', 'legacy-token');
		window.localStorage.setItem('theme', 'light');
		window.sessionStorage.setItem('workos:code-verifier', 'old-verifier');
		client = await createPricingAuthClient();
		expect(window.localStorage.getItem('theme')).toBe('light');
		expect(window.localStorage.getItem('workos:refresh-token:client_previous')).toBeNull();
		expect(window.localStorage.getItem('workos:refresh-token')).toBeNull();
		expect(window.sessionStorage.getItem('workos:code-verifier')).toBeNull();
		window.localStorage.removeItem('theme');
	});

	test('loads the user and caches only the server access token', async () => {
		const timeout = spyOn(AbortSignal, 'timeout');
		client = await createPricingAuthClient();

		expect(client.getUser()).toEqual(user);
		expect(await client.getAccessToken()).toBe('opaque-access-token');
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			path: '/api/pricing/session',
			init: {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Pricing-Auth': '1' },
				body: '{"forceRefresh":false}',
				cache: 'no-store',
				credentials: 'same-origin'
			}
		});
		expect(requests[0].init.signal).toBeInstanceOf(AbortSignal);
		expect(timeout).toHaveBeenCalledWith(12_000);
	});

	test('initializes signed out from a null session', async () => {
		fetchBehavior = async () => Response.json({ user: null, accessToken: null, expiresAt: null });
		client = await createPricingAuthClient();
		expect(client.getUser()).toBeNull();
		expect(await client.getAccessToken()).toBeUndefined();
	});

	test('reports a server initialization error', async () => {
		fetchBehavior = async () => Response.json({ error: 'Session unavailable' }, { status: 503 });
		await expect(createPricingAuthClient()).rejects.toThrow('Session unavailable');
	});
});

describe('pricing access token refresh', () => {
	test('refreshes at the server expiry buffer without forcing WorkOS refresh', async () => {
		const now = Date.now();
		spyOn(Date, 'now').mockReturnValue(now);
		fetchBehavior = async () => session('old-token', now + 60_001);
		client = await createPricingAuthClient();
		expect(await client.getAccessToken()).toBe('old-token');
		expect(requests).toHaveLength(1);

		spyOn(Date, 'now').mockReturnValue(now + 1);
		fetchBehavior = async () => session('renewed-token', now + 300_000);
		expect(await client.getAccessToken()).toBe('renewed-token');
		expect(requests[1].init.body).toBe('{"forceRefresh":false}');
		expect(await client.getAccessToken()).toBe('renewed-token');
		expect(requests).toHaveLength(2);
	});

	test('deduplicates forced refreshes even with a valid cached token', async () => {
		client = await createPricingAuthClient();
		const refresh = deferred<Response>();
		fetchBehavior = () => refresh.promise;
		const first = client.getAccessToken({ forceRefresh: true });
		const second = client.getAccessToken({ forceRefresh: true });
		expect(requests).toHaveLength(2);
		expect(requests[1].init.body).toBe('{"forceRefresh":true}');
		refresh.resolve(session('new-token'));
		expect(await Promise.all([first, second])).toEqual(['new-token', 'new-token']);
	});

	test('fetches again when the server supplies no token expiry', async () => {
		fetchBehavior = async () => Response.json({ user, accessToken: 'token', expiresAt: null });
		client = await createPricingAuthClient();
		fetchBehavior = async () => session('new-token');
		expect(await client.getAccessToken()).toBe('new-token');
		expect(requests).toHaveLength(2);
	});

	test('preserves the user and cached token after server and network failures', async () => {
		client = await createPricingAuthClient();
		fetchBehavior = async () => Response.json({ error: 'Try again' }, { status: 503 });
		await expect(client.getAccessToken({ forceRefresh: true })).rejects.toThrow('Try again');
		expect(client.getUser()).toEqual(user);
		expect(await client.getAccessToken()).toBe('opaque-access-token');

		fetchBehavior = async () => {
			throw new TypeError('Network offline');
		};
		await expect(client.getAccessToken({ forceRefresh: true })).rejects.toThrow('Network offline');
		expect(client.getUser()).toEqual(user);
		expect(await client.getAccessToken()).toBe('opaque-access-token');

		fetchBehavior = async () => session('recovered-token');
		expect(await client.getAccessToken({ forceRefresh: true })).toBe('recovered-token');
	});

	test('clears user and token when the session reports no user', async () => {
		client = await createPricingAuthClient();
		fetchBehavior = async () =>
			Response.json({ user: null, accessToken: 'ignored-token', expiresAt: Date.now() + 300_000 });
		expect(await client.getAccessToken({ forceRefresh: true })).toBeUndefined();
		expect(client.getUser()).toBeNull();
	});

	test('treats a 401 as signed out, including an empty response body', async () => {
		client = await createPricingAuthClient();
		fetchBehavior = async () => new Response(null, { status: 401 });
		expect(await client.getAccessToken({ forceRefresh: true })).toBeUndefined();
		expect(client.getUser()).toBeNull();
	});
});

describe('pricing session navigation and disposal', () => {
	test('direct sign-out posts to the server without loading a session and follows its logout URL', async () => {
		const assign = spyOn(window.location, 'assign').mockImplementation(() => {});
		fetchBehavior = async () => Response.json({ logoutUrl: 'https://api.workos.com/logout?sid=1' });
		await signOutPricingSession();

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			path: '/api/pricing/sign-out',
			init: {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Pricing-Auth': '1' },
				body: '{}',
				cache: 'no-store',
				credentials: 'same-origin'
			}
		});
		expect(assign).toHaveBeenCalledWith('https://api.workos.com/logout?sid=1');
	});

	test('direct sign-out accepts an already signed-out session without redirecting', async () => {
		const assign = spyOn(window.location, 'assign').mockImplementation(() => {});
		fetchBehavior = async () => Response.json({ logoutUrl: null });
		await signOutPricingSession();
		expect(requests).toHaveLength(1);
		expect(assign).not.toHaveBeenCalled();
	});

	test('direct sign-out validates the logout URL and reports server failures', async () => {
		const assign = spyOn(window.location, 'assign').mockImplementation(() => {});
		fetchBehavior = async () => Response.json({ logoutUrl: 'https://untrusted.example/logout' });
		await expect(signOutPricingSession()).rejects.toThrow('invalid logout URL');
		expect(assign).not.toHaveBeenCalled();

		fetchBehavior = async () => Response.json({ error: 'Sign-out unavailable' }, { status: 503 });
		await expect(signOutPricingSession()).rejects.toThrow('Sign-out unavailable');
	});

	test('sign-in assigns the fixed same-origin server route', async () => {
		const assign = spyOn(window.location, 'assign').mockImplementation(() => {});
		client = await createPricingAuthClient();
		await client.signIn();
		expect(assign).toHaveBeenCalledWith('/api/pricing/sign-in');
		expect(requests).toHaveLength(1);
	});

	test('sign-out drains refresh before posting and fences the late session response', async () => {
		const assign = spyOn(window.location, 'assign').mockImplementation(() => {});
		client = await createPricingAuthClient();
		const refresh = deferred<Response>();
		fetchBehavior = () => refresh.promise;
		const token = client.getAccessToken({ forceRefresh: true });
		const signOut = client.signOut();
		expect(client.getUser()).toBeNull();
		expect(await client.getAccessToken()).toBeUndefined();
		expect(requests).toHaveLength(2);

		fetchBehavior = async () => Response.json({ logoutUrl: 'https://api.workos.com/logout?sid=1' });
		refresh.resolve(session('late-token'));
		expect(await token).toBeUndefined();
		await signOut;
		expect(requests).toHaveLength(3);
		expect(requests[2]).toMatchObject({
			path: '/api/pricing/sign-out',
			init: {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Pricing-Auth': '1' },
				body: '{}',
				cache: 'no-store',
				credentials: 'same-origin'
			}
		});
		expect(assign).toHaveBeenCalledWith('https://api.workos.com/logout?sid=1');
		expect(client.getUser()).toBeNull();
		expect(await client.getAccessToken()).toBeUndefined();
	});

	test('sign-out proceeds after a failed refresh and accepts no logout redirect', async () => {
		const assign = spyOn(window.location, 'assign').mockImplementation(() => {});
		client = await createPricingAuthClient();
		const refresh = deferred<Response>();
		fetchBehavior = () => refresh.promise;
		const token = client.getAccessToken({ forceRefresh: true });
		const tokenError = token.catch((error: Error) => error.message);
		const signOut = client.signOut();
		fetchBehavior = async () => Response.json({ logoutUrl: null });
		refresh.reject(new Error('Refresh failed'));
		expect(await tokenError).toBe('Refresh failed');
		await signOut;
		expect(requests[2].path).toBe('/api/pricing/sign-out');
		expect(client.getUser()).toBeNull();
		expect(assign).not.toHaveBeenCalled();
	});

	test('clears memory even if server sign-out fails', async () => {
		client = await createPricingAuthClient();
		fetchBehavior = async () => Response.json({ error: 'Sign-out unavailable' }, { status: 503 });
		await expect(client.signOut()).rejects.toThrow('Sign-out unavailable');
		expect(client.getUser()).toBeNull();
		expect(await client.getAccessToken()).toBeUndefined();
	});

	test('disposal clears memory and fences an in-flight response', async () => {
		client = await createPricingAuthClient();
		const refresh = deferred<Response>();
		fetchBehavior = () => refresh.promise;
		const token = client.getAccessToken({ forceRefresh: true });
		client.dispose();
		refresh.resolve(session('late-token'));
		expect(await token).toBeUndefined();
		expect(client.getUser()).toBeNull();
		expect(await client.getAccessToken({ forceRefresh: true })).toBeUndefined();
		expect(requests).toHaveLength(2);
	});
});
