import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { getFunctionName } from 'convex/server';
import type { PricingAuthClient, PricingUser } from '@/lib/pricing/auth-client';
import {
	createCheckout,
	fetchCheckoutStatus,
	fetchMySubscription,
	fetchPublicPricingCatalog,
	initializePricingBilling,
	openCustomerPortal,
	resetPricingBillingForTests,
	signInForPricing,
	signOutOfPricing
} from '@/lib/pricing/billing-client';
import { createBillingOperations } from '@/lib/pricing/operation';

type ConvexRoute = 'getMySubscription' | 'getCheckoutStatus' | 'customerPortal' | 'checkout';

// anyApi references are lazily-resolved proxies with no stable identity, so
// route on the argument shape each billing entry point uses.

function routeFor(args: unknown): ConvexRoute | null {
	const record = args as Record<string, unknown>;
	if (typeof record.attemptId === 'string') return 'getCheckoutStatus';
	if (typeof record.tier === 'string') return 'checkout';
	return null;
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

const sessionMemory = new Map<string, string>();
const sessionStorageMock = {
	getItem: (key: string) => sessionMemory.get(key) ?? null,
	setItem: (key: string, value: string) => void sessionMemory.set(key, value),
	removeItem: (key: string) => void sessionMemory.delete(key)
};

function restoreStorage(): void {
	Object.defineProperty(globalThis, 'sessionStorage', {
		value: sessionStorageMock,
		configurable: true
	});
}

restoreStorage();

let currentUser: PricingUser | null;
let authCreationBehavior: () => Promise<PricingAuthClient>;
const auth = {
	getUser: () => currentUser,
	getAccessToken: mock<PricingAuthClient['getAccessToken']>(async () => 'access-token'),
	signIn: mock(async () => {}),
	signOut: mock(async () => {}),
	dispose: mock(() => {})
} satisfies PricingAuthClient;
const createAuth = mock(() => authCreationBehavior());
const directSignOut = mock(async () => {});
const httpClients: { url: string; token: string | undefined }[] = [];
const convexCalls: { route: ConvexRoute; args: unknown; token: string | undefined }[] = [];
let checkoutBehavior: () => Promise<{
	checkout_url: string;
	attemptId?: string;
	sessionId?: string;
	mode?: unknown;
}>;
let statusBehavior: () => Promise<{
	attemptId: string;
	status: string;
	activated?: boolean;
	checkout_url?: string;
	mode?: unknown;
	sessionId?: string;
	expiresAt?: number;
}>;
let portalBehavior: () => Promise<{ portal_url: string }>;
let subscriptionBehavior: () => Promise<{
	tier: string;
	tierLabel: string;
	billingManaged: boolean;
}>;

const originalConvexUrl = process.env.PUBLIC_CONVEX_URL;
const originalCheckoutMode = process.env.PUBLIC_DODO_CHECKOUT_MODE;

mock.module('@/lib/pricing/auth-client', () => ({
	createPricingAuthClient: createAuth,
	signOutPricingSession: directSignOut
}));

mock.module('convex/browser', () => ({
	ConvexHttpClient: class {
		token: string | undefined;
		constructor(public url: string) {
			httpClients.push(this);
		}
		setAuth(token: string) {
			this.token = token;
		}
		async query(ref: unknown, args: unknown) {
			convexCalls.push({ route: 'getMySubscription', args, token: this.token });
			return subscriptionBehavior();
		}
		async action(ref: unknown, args: unknown) {
			if (
				getFunctionName(ref as Parameters<typeof getFunctionName>[0]) === 'pricing:getPublicCatalog'
			) {
				return { plans: [] };
			}
			const route = routeFor(args) ?? 'customerPortal';
			convexCalls.push({ route, args, token: this.token });
			if (route === 'getCheckoutStatus') return statusBehavior();
			if (route === 'customerPortal') return portalBehavior();
			if (route === 'checkout') return checkoutBehavior();
			throw new Error(`Unexpected action route: ${route}`);
		}
	}
}));

function initiatingUser(): PricingUser {
	return { id: 'user-a', email: 'a@example.com', firstName: null };
}

function userB(): PricingUser {
	return { id: 'user-b', email: 'b@example.com', firstName: null };
}

function storedAttempt(): Record<string, unknown> | null {
	const raw = sessionMemory.get('spikonado_pricing_attempt');
	return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

beforeEach(() => {
	restoreStorage();
	process.env.PUBLIC_CONVEX_URL = 'https://billing-tests.convex.cloud';
	process.env.PUBLIC_DODO_CHECKOUT_MODE = 'test';
	currentUser = initiatingUser();
	convexCalls.length = 0;
	httpClients.length = 0;
	sessionMemory.clear();
	authCreationBehavior = async () => auth;
	createAuth.mockClear();
	directSignOut.mockReset();
	directSignOut.mockResolvedValue(undefined);
	auth.getAccessToken.mockReset();
	auth.getAccessToken.mockResolvedValue('access-token');
	auth.signIn.mockReset();
	auth.signIn.mockResolvedValue(undefined);
	auth.signOut.mockReset();
	auth.signOut.mockResolvedValue(undefined);
	auth.dispose.mockClear();
	subscriptionBehavior = async () => ({
		tier: 'free',
		tierLabel: 'Free',
		billingManaged: false
	});
	statusBehavior = async () => ({ attemptId: 'attempt-1', status: 'pending' });
	portalBehavior = async () => ({ portal_url: 'https://portal.example/session' });
	checkoutBehavior = async () => ({
		checkout_url: 'https://test.checkout.dodopayments.com/session/cks_a',
		attemptId: 'attempt-1',
		mode: 'test'
	});
	resetPricingBillingForTests();
});

afterEach(() => {
	restoreStorage();
	resetPricingBillingForTests();
	if (originalConvexUrl === undefined) delete process.env.PUBLIC_CONVEX_URL;
	else process.env.PUBLIC_CONVEX_URL = originalConvexUrl;
	if (originalCheckoutMode === undefined) delete process.env.PUBLIC_DODO_CHECKOUT_MODE;
	else process.env.PUBLIC_DODO_CHECKOUT_MODE = originalCheckoutMode;
});

describe('pricing billing authentication', () => {
	test('concurrent initialization shares the configured auth adapter', async () => {
		const creation = deferred<PricingAuthClient>();
		authCreationBehavior = () => creation.promise;
		const first = initializePricingBilling();
		const second = initializePricingBilling();
		creation.resolve(auth);

		const client = await first;
		expect(await second).toBe(client);
		expect(await initializePricingBilling()).toBe(client);
		expect(client.auth).toBe(auth);
		expect(client.isConfigured).toBe(true);
		expect(client.error).toBeNull();
		expect(createAuth.mock.calls).toEqual([[]]);
	});

	test('initialization requires a Convex URL and retries once it is configured', async () => {
		delete process.env.PUBLIC_CONVEX_URL;
		await expect(initializePricingBilling()).rejects.toThrow('missing PUBLIC_CONVEX_URL');
		process.env.PUBLIC_CONVEX_URL = ' https://billing-tests.convex.cloud ';

		await fetchMySubscription('user-a');
		expect(httpClients[0].url).toBe('https://billing-tests.convex.cloud');
		expect(createAuth).toHaveBeenCalledTimes(1);
	});

	test('an adapter initialization failure propagates and permits a retry', async () => {
		authCreationBehavior = async () => {
			throw new Error('Session service is unavailable.');
		};
		await expect(initializePricingBilling()).rejects.toThrow('Session service is unavailable.');
		authCreationBehavior = async () => auth;

		expect((await initializePricingBilling()).auth).toBe(auth);
		expect(createAuth).toHaveBeenCalledTimes(2);
	});

	test('each billing operation uses a fresh HTTP client with its own token', async () => {
		auth.getAccessToken
			.mockResolvedValueOnce('subscription-token')
			.mockResolvedValueOnce('checkout-token')
			.mockResolvedValueOnce('status-token')
			.mockResolvedValueOnce('portal-token');

		await fetchMySubscription('user-a');
		await createCheckout('team', 'monthly', 'user-a');
		await fetchCheckoutStatus('attempt-1', 'user-a');
		await openCustomerPortal('user-a');

		expect(convexCalls.map(({ route, token }) => ({ route, token }))).toEqual([
			{ route: 'getMySubscription', token: 'subscription-token' },
			{ route: 'checkout', token: 'checkout-token' },
			{ route: 'getCheckoutStatus', token: 'status-token' },
			{ route: 'customerPortal', token: 'portal-token' }
		]);
		expect(httpClients.map((http) => http.token)).toEqual([
			'subscription-token',
			'checkout-token',
			'status-token',
			'portal-token'
		]);
		expect(new Set(httpClients).size).toBe(4);
		expect(auth.getAccessToken.mock.calls).toEqual([[], [], [], []]);
	});

	test('public catalog fetch uses unauthenticated HTTP without initializing auth', async () => {
		expect(await fetchPublicPricingCatalog()).toEqual({ plans: [] });
		expect(httpClients).toHaveLength(1);
		expect(httpClients[0].token).toBeUndefined();
		expect(createAuth).not.toHaveBeenCalled();
	});

	const billingOperations = [
		['subscription', () => fetchMySubscription('user-a')],
		['checkout', () => createCheckout('team', 'monthly', 'user-a')],
		['status', () => fetchCheckoutStatus('attempt-1', 'user-a')],
		['portal', () => openCustomerPortal('user-a')]
	] as const;

	for (const [name, run] of billingOperations) {
		test(`${name} propagates token failures and succeeds on a later retry`, async () => {
			auth.getAccessToken.mockRejectedValueOnce(new Error('Session temporarily unavailable.'));
			await expect(run()).rejects.toThrow('Session temporarily unavailable.');
			expect(convexCalls).toEqual([]);

			await run();
			expect(convexCalls).toHaveLength(1);
			expect(convexCalls[0].token).toBe('access-token');
			expect(createAuth).toHaveBeenCalledTimes(1);
		});

		test(`${name} requires an access token before issuing a request`, async () => {
			auth.getAccessToken.mockResolvedValueOnce(undefined);
			await expect(run()).rejects.toThrow('Sign in to continue this billing action.');
			expect(convexCalls).toEqual([]);
		});

		test(`${name} cancels when token refresh switches the account`, async () => {
			auth.getAccessToken.mockImplementationOnce(async () => {
				currentUser = userB();
				return 'user-b-token';
			});
			await expect(run()).rejects.toThrow('This billing action was cancelled.');
			expect(convexCalls).toEqual([]);
		});
	}

	test('subscription remains free when signed out without fetching a token', async () => {
		currentUser = null;
		expect(await fetchMySubscription()).toEqual({
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: false
		});
		expect(auth.getAccessToken).not.toHaveBeenCalled();
	});

	test('sign-in delegates to the adapter without SDK options', async () => {
		await signInForPricing();
		expect(auth.signIn.mock.calls).toEqual([[]]);
	});

	test('cold sign-out uses the server route without creating an adapter or requiring Convex', async () => {
		delete process.env.PUBLIC_CONVEX_URL;
		await signOutOfPricing();

		expect(directSignOut.mock.calls).toEqual([[]]);
		expect(createAuth).not.toHaveBeenCalled();
	});

	test('sign-out uses the server route after initialization has failed', async () => {
		authCreationBehavior = async () => {
			throw new Error('Session unavailable.');
		};
		await expect(initializePricingBilling()).rejects.toThrow('Session unavailable.');
		await signOutOfPricing();

		expect(directSignOut).toHaveBeenCalledTimes(1);
		expect(createAuth).toHaveBeenCalledTimes(1);
	});

	test('sign-out waits for pending initialization before using the adapter', async () => {
		const creation = deferred<PricingAuthClient>();
		authCreationBehavior = () => creation.promise;
		const initialization = initializePricingBilling();
		const signOut = signOutOfPricing();
		expect(auth.signOut).not.toHaveBeenCalled();
		expect(directSignOut).not.toHaveBeenCalled();

		creation.resolve(auth);
		await initialization;
		await signOut;
		expect(auth.signOut).toHaveBeenCalledTimes(1);
		expect(auth.dispose).toHaveBeenCalledTimes(1);
		expect(directSignOut).not.toHaveBeenCalled();
	});

	test('sign-out waits for pending initialization to fail before using the server route', async () => {
		const creation = deferred<PricingAuthClient>();
		authCreationBehavior = () => creation.promise;
		const initialization = initializePricingBilling().catch((error: Error) => error.message);
		const signOut = signOutOfPricing();
		expect(directSignOut).not.toHaveBeenCalled();

		creation.reject(new Error('Session unavailable.'));
		expect(await initialization).toBe('Session unavailable.');
		await signOut;
		expect(directSignOut).toHaveBeenCalledTimes(1);
		expect(createAuth).toHaveBeenCalledTimes(1);
	});

	test('a direct server sign-out failure propagates and permits fresh initialization', async () => {
		directSignOut.mockRejectedValueOnce(new Error('Sign-out unavailable.'));
		await expect(signOutOfPricing()).rejects.toThrow('Sign-out unavailable.');

		expect((await initializePricingBilling()).auth).toBe(auth);
		expect(createAuth).toHaveBeenCalledTimes(1);
	});

	test('sign-out delegates without SDK options, disposes auth, then resets billing', async () => {
		const client = await initializePricingBilling();
		await signOutOfPricing();

		expect(auth.signOut.mock.calls).toEqual([[]]);
		expect(auth.dispose).toHaveBeenCalledTimes(1);
		expect(directSignOut).not.toHaveBeenCalled();
		expect(await initializePricingBilling()).not.toBe(client);
		expect(createAuth).toHaveBeenCalledTimes(2);
	});

	test('billing can initialize a fresh session after a server sign-out failure', async () => {
		const client = await initializePricingBilling();
		auth.signOut.mockRejectedValueOnce(new Error('Sign-out unavailable.'));
		await expect(signOutOfPricing()).rejects.toThrow('Sign-out unavailable.');

		expect(auth.dispose).toHaveBeenCalledTimes(1);
		expect(await initializePricingBilling()).not.toBe(client);
		expect(createAuth).toHaveBeenCalledTimes(2);
	});
});

describe('createCheckout account scoping', () => {
	test('cancellation during token fetching stops checkout before the provider action', async () => {
		const token = deferred<string>();
		const tokenStarted = deferred<void>();
		auth.getAccessToken.mockImplementationOnce(() => {
			tokenStarted.resolve();
			return token.promise;
		});
		const operations = createBillingOperations();
		const guard = operations.begin('user-a');
		const pending = createCheckout('team', 'monthly', 'user-a', guard.isCurrent);
		await tokenStarted.promise;
		operations.bumpGeneration();
		token.resolve('access-token');

		await expect(pending).rejects.toThrow('This billing action was cancelled.');
		expect(convexCalls).toEqual([]);
		expect(storedAttempt()).toBeNull();
	});

	test('cancellation during initialization stops checkout before the provider action', async () => {
		const creation = deferred<PricingAuthClient>();
		const creationStarted = deferred<void>();
		authCreationBehavior = () => {
			creationStarted.resolve();
			return creation.promise;
		};
		const operations = createBillingOperations();
		const guard = operations.begin('user-a');
		const pending = createCheckout('team', 'monthly', 'user-a', guard.isCurrent);
		await creationStarted.promise;
		operations.bumpGeneration();
		creation.resolve(auth);

		await expect(pending).rejects.toThrow('This billing action was cancelled.');
		expect(convexCalls).toEqual([]);
	});

	test('an out-of-order same-account response preserves the current recovery attempt', async () => {
		const oldResult = deferred<Awaited<ReturnType<typeof checkoutBehavior>>>();
		const oldActionStarted = deferred<void>();
		checkoutBehavior = () => {
			oldActionStarted.resolve();
			return oldResult.promise;
		};
		const operations = createBillingOperations();
		const oldGuard = operations.begin('user-a');
		const oldCheckout = createCheckout('team', 'monthly', 'user-a', oldGuard.isCurrent);
		await oldActionStarted.promise;

		const currentGuard = operations.begin('user-a');
		checkoutBehavior = async () => ({
			checkout_url: 'https://test.checkout.dodopayments.com/session/cks_current',
			attemptId: 'attempt-current',
			mode: 'test'
		});
		const current = await createCheckout('team', 'annual', 'user-a', currentGuard.isCurrent);
		const currentAttempt = {
			userId: 'user-a',
			attemptId: 'attempt-current',
			tierId: 'team',
			interval: 'annual'
		};
		expect(current.attemptId).toBe('attempt-current');
		expect(storedAttempt()).toEqual(currentAttempt);

		oldResult.resolve({
			checkout_url: 'https://test.checkout.dodopayments.com/session/cks_old',
			attemptId: 'attempt-old',
			mode: 'test'
		});
		await expect(oldCheckout).rejects.toThrow('This billing action was cancelled.');
		expect(storedAttempt()).toEqual(currentAttempt);
		expect(convexCalls.map((call) => call.args)).toEqual([
			{ tier: 'team', interval: 'monthly' },
			{ tier: 'team', interval: 'annual' }
		]);
	});

	test('a recovery write failure reports storage configuration instead of returning a payment link', async () => {
		Object.defineProperty(globalThis, 'sessionStorage', {
			value: {
				...sessionStorageMock,
				setItem: () => {
					throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
				}
			},
			configurable: true
		});
		await expect(createCheckout('team', 'monthly', 'user-a')).rejects.toThrow(
			'Browser storage is unavailable. Enable site storage before starting checkout.'
		);
	});

	test('an account switch during the provider action cancels: no URL returns and nothing is stored', async () => {
		const action = deferred<{ checkout_url: string; attemptId?: string }>();
		checkoutBehavior = async () => {
			// The provider session is being created for user-a; user-b signs in
			// before it comes back.
			currentUser = userB();
			return action.promise;
		};
		const pending = createCheckout('team', 'monthly', 'user-a');
		action.resolve({ checkout_url: 'https://checkout.example/session/cks_a', attemptId: 'a-1' });
		await expect(pending).rejects.toThrow('This billing action was cancelled.');
		expect(storedAttempt()).toBeNull();
	});

	test('a sign-out during the provider action cancels: no URL returns and nothing is stored', async () => {
		const action = deferred<{ checkout_url: string; attemptId?: string }>();
		checkoutBehavior = async () => {
			currentUser = null;
			return action.promise;
		};
		const pending = createCheckout('team', 'monthly', 'user-a');
		action.resolve({ checkout_url: 'https://checkout.example/session/cks_a', attemptId: 'a-1' });
		await expect(pending).rejects.toThrow('This billing action was cancelled.');
		expect(storedAttempt()).toBeNull();
	});

	test('a caller bound to a different account never reaches the provider', async () => {
		await expect(createCheckout('team', 'monthly', 'user-b')).rejects.toThrow(
			'This billing action was cancelled.'
		);
		const actions = convexCalls.filter(
			(call) => (call.args as Record<string, unknown>).tier === 'team'
		);
		expect(actions).toEqual([]);
		expect(storedAttempt()).toBeNull();
	});

	test('a successful checkout stores the attempt for the initiating account only', async () => {
		const result = await createCheckout('team', 'monthly', 'user-a');
		expect(result.checkoutUrl).toBe('https://test.checkout.dodopayments.com/session/cks_a');
		expect(result.attemptId).toBe('attempt-1');
		expect(storedAttempt()).toMatchObject({ userId: 'user-a', attemptId: 'attempt-1' });
	});

	test('a legacy checkout without an attempt cannot open without recovery', async () => {
		checkoutBehavior = async () => ({ checkout_url: 'https://checkout.example/session/legacy' });
		await expect(createCheckout('team', 'monthly', 'user-a')).rejects.toThrow(
			'Checkout recovery is unavailable'
		);
		expect(storedAttempt()).toBeNull();
	});
});

describe('checkout mode agreement on returned payloads', () => {
	test('a mode mismatch refuses to hand out the checkout URL but keeps recovery', async () => {
		checkoutBehavior = async () => ({
			checkout_url: 'https://checkout.example/session/cks_live',
			attemptId: 'attempt-live',
			mode: 'live'
		});
		await expect(createCheckout('team', 'monthly', 'user-a')).rejects.toThrow(
			'Checkout is configured in test mode but this checkout link is live mode.'
		);
		// The provider session exists, so the attempt reference stays persisted
		// for status-based recovery even though the URL was never handed out.
		expect(storedAttempt()).toMatchObject({ userId: 'user-a', attemptId: 'attempt-live' });
	});

	test('an unconfirmed checkout mode fails closed while keeping recovery', async () => {
		checkoutBehavior = async () => ({
			checkout_url: 'https://checkout.example/session/cks_none',
			attemptId: 'attempt-none'
		});
		await expect(createCheckout('team', 'monthly', 'user-a')).rejects.toThrow(
			'Checkout did not report its billing mode.'
		);
		expect(storedAttempt()).toMatchObject({ userId: 'user-a', attemptId: 'attempt-none' });
	});

	test('a resumable status URL with a mismatched mode fails closed', async () => {
		statusBehavior = async () => ({
			attemptId: 'attempt-1',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/cks_a',
			mode: 'live'
		});
		await expect(fetchCheckoutStatus('attempt-1', 'user-a')).rejects.toThrow(
			'Checkout is configured in test mode but this checkout link is live mode.'
		);
	});

	test('a resumable status URL with a matching mode passes through', async () => {
		statusBehavior = async () => ({
			attemptId: 'attempt-1',
			status: 'awaiting_payment',
			checkout_url: 'https://test.checkout.dodopayments.com/session/cks_a',
			mode: 'test'
		});
		const status = await fetchCheckoutStatus('attempt-1', 'user-a');
		expect(status.status).toBe('awaiting_payment');
		expect(status.checkout_url).toBe('https://test.checkout.dodopayments.com/session/cks_a');
	});

	test('redirects only to the expected Dodo origin while preserving recovery', async () => {
		for (const checkout_url of [
			'https://checkout.example/session/cks_untrusted',
			'https://checkout.dodopayments.com/session/cks_live',
			'javascript:alert(1)'
		]) {
			checkoutBehavior = async () => ({ checkout_url, attemptId: 'invalid-origin', mode: 'test' });
			await expect(createCheckout('team', 'monthly', 'user-a')).rejects.toThrow(
				'invalid hosted URL'
			);
			expect(storedAttempt()).toMatchObject({ attemptId: 'invalid-origin', userId: 'user-a' });
		}
	});
});

describe('fetchMySubscription account scoping', () => {
	test('an account switch during the query cancels the stale result', async () => {
		const query = deferred<{ tier: string; tierLabel: string; billingManaged: boolean }>();
		subscriptionBehavior = () => {
			currentUser = userB();
			return query.promise;
		};
		const pending = fetchMySubscription('user-a');
		query.resolve({ tier: 'team', tierLabel: 'Team', billingManaged: true });
		await expect(pending).rejects.toThrow('This billing action was cancelled.');
	});

	test('a caller bound to a different account never issues the query', async () => {
		await expect(fetchMySubscription('user-b')).rejects.toThrow(
			'This billing action was cancelled.'
		);
		const queries = convexCalls.filter((call) => call.route === 'getMySubscription');
		expect(queries).toEqual([]);
	});

	test('a stable account receives the subscription result', async () => {
		subscriptionBehavior = async () => ({
			tier: 'team',
			tierLabel: 'Team',
			billingManaged: true
		});
		const result = await fetchMySubscription('user-a');
		expect(result.tier).toBe('team');
	});
});

describe('fetchCheckoutStatus account scoping', () => {
	test('an account switch during the status lookup cancels the stale result', async () => {
		const action = deferred<{ attemptId: string; status: string }>();
		statusBehavior = () => {
			currentUser = userB();
			return action.promise;
		};
		const pending = fetchCheckoutStatus('attempt-1', 'user-a');
		action.resolve({ attemptId: 'attempt-1', status: 'succeeded' });
		await expect(pending).rejects.toThrow('This billing action was cancelled.');
	});

	test('a caller bound to a different account never issues the lookup', async () => {
		await expect(fetchCheckoutStatus('attempt-1', 'user-b')).rejects.toThrow(
			'This billing action was cancelled.'
		);
		const lookups = convexCalls.filter((call) => call.route === 'getCheckoutStatus');
		expect(lookups).toEqual([]);
	});
});

describe('openCustomerPortal account scoping', () => {
	test('an account switch during the portal action never returns a portal URL', async () => {
		const action = deferred<{ portal_url: string }>();
		portalBehavior = () => {
			currentUser = userB();
			return action.promise;
		};
		const pending = openCustomerPortal('user-a');
		action.resolve({ portal_url: 'https://portal.example/session' });
		await expect(pending).rejects.toThrow('This billing action was cancelled.');
	});

	test('a sign-out during the portal action never returns a portal URL', async () => {
		const action = deferred<{ portal_url: string }>();
		portalBehavior = () => {
			currentUser = null;
			return action.promise;
		};
		const pending = openCustomerPortal('user-a');
		action.resolve({ portal_url: 'https://portal.example/session' });
		await expect(pending).rejects.toThrow('This billing action was cancelled.');
	});

	test('a caller bound to a different account never issues the portal action', async () => {
		await expect(openCustomerPortal('user-b')).rejects.toThrow(
			'This billing action was cancelled.'
		);
		const actions = convexCalls.filter((call) => call.route === 'customerPortal');
		expect(actions).toEqual([]);
	});
});
