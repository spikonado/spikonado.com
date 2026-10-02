import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { User } from '@workos-inc/authkit-js';
import {
	createCheckout,
	fetchCheckoutGate,
	fetchCheckoutStatus,
	fetchMySubscription,
	openCustomerPortal,
	resetPricingBillingForTests
} from '@/lib/pricing/billing-client';

type ConvexRoute =
	'getMySubscription' | 'checkoutEligibility' | 'getCheckoutStatus' | 'customerPortal' | 'checkout';

// anyApi references are lazily-resolved proxies with no stable identity, so
// route on the argument shape each billing entry point uses. The two no-arg
// queries are disambiguated per test: each flow exercises only one of them.
let noArgsQueryRoute: 'getMySubscription' | 'checkoutEligibility';

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
Object.defineProperty(globalThis, 'sessionStorage', {
	value: {
		getItem: (key: string) => sessionMemory.get(key) ?? null,
		setItem: (key: string, value: string) => void sessionMemory.set(key, value),
		removeItem: (key: string) => void sessionMemory.delete(key)
	},
	configurable: true
});

let currentUser: User | null;
const convexCalls: { route: ConvexRoute; args: unknown }[] = [];
let checkoutBehavior: () => Promise<{
	checkout_url: string;
	attemptId?: string;
	sessionId?: string;
}>;
let statusBehavior: () => Promise<{
	attemptId: string;
	status: string;
	activated?: boolean;
}>;
let portalBehavior: () => Promise<{ portal_url: string }>;
let subscriptionBehavior: () => Promise<{
	tier: string;
	tierLabel: string;
	billingManaged: boolean;
}>;
let gateBehavior: () => Promise<{
	eligibility: string;
	checkoutEnabled: boolean;
	reason: string;
	mode: unknown;
}>;
let gateMode: unknown = 'test_mode';

mock.module('@workos-inc/authkit-js', () => ({
	createClient: async () => {
		return { getUser: () => currentUser, signIn: async () => {} };
	}
}));

mock.module('convex/browser', () => ({
	ConvexHttpClient: class {
		constructor(public url: string) {}
		async query() {
			return { workosClientId: 'workos-test-client' };
		}
		async action() {
			return { plans: [] };
		}
	},
	ConvexClient: class {
		constructor(public url: string) {}
		setAuth() {}
		async query(ref: unknown, args: unknown) {
			const route = routeFor(args) ?? noArgsQueryRoute;
			convexCalls.push({ route, args });
			if (route === 'getMySubscription') return subscriptionBehavior();
			if (route === 'checkoutEligibility') return gateBehavior();
			throw new Error(`Unexpected query route: ${route}`);
		}
		async action(ref: unknown, args: unknown) {
			const route = routeFor(args) ?? 'customerPortal';
			convexCalls.push({ route, args });
			if (route === 'getCheckoutStatus') return statusBehavior();
			if (route === 'customerPortal') return portalBehavior();
			if (route === 'checkout') return checkoutBehavior();
			throw new Error(`Unexpected action route: ${route}`);
		}
		async close() {}
	}
}));

function initiatingUser(): User {
	return { id: 'user-a', email: 'a@example.com' } as User;
}

function userB(): User {
	return { id: 'user-b', email: 'b@example.com' } as User;
}

function storedAttempt(): Record<string, unknown> | null {
	const raw = sessionMemory.get('spikonado_pricing_attempt');
	return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

beforeEach(() => {
	currentUser = initiatingUser();
	convexCalls.length = 0;
	sessionMemory.clear();
	gateMode = 'test_mode';
	noArgsQueryRoute = 'checkoutEligibility';
	gateBehavior = async () => ({
		eligibility: 'purchasable',
		checkoutEnabled: true,
		reason: '',
		mode: gateMode
	});
	subscriptionBehavior = async () => ({
		tier: 'free',
		tierLabel: 'Free',
		billingManaged: false
	});
	statusBehavior = async () => ({ attemptId: 'attempt-1', status: 'pending' });
	portalBehavior = async () => ({ portal_url: 'https://portal.example/session' });
	checkoutBehavior = async () => ({
		checkout_url: 'https://checkout.example/session/cks_a',
		attemptId: 'attempt-1'
	});
	resetPricingBillingForTests();
});

afterEach(() => {
	resetPricingBillingForTests();
});

describe('createCheckout account scoping', () => {
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
		expect(result.checkoutUrl).toBe('https://checkout.example/session/cks_a');
		expect(result.attemptId).toBe('attempt-1');
		expect(storedAttempt()).toMatchObject({ userId: 'user-a', attemptId: 'attempt-1' });
	});
});

describe('checkout gate mode agreement', () => {
	test('the backend test_mode environment maps to the test overlay mode', async () => {
		const gate = await fetchCheckoutGate();
		expect(gate.mode).toBe('test');
	});

	test('a missing backend mode stays unconfirmed so checkout fails closed', async () => {
		gateMode = undefined;
		const gate = await fetchCheckoutGate();
		expect(gate.mode).toBeUndefined();
		await expect(createCheckout('team', 'monthly', 'user-a')).rejects.toThrow(
			'Checkout mode is not confirmed by the billing backend.'
		);
	});
});

describe('fetchMySubscription account scoping', () => {
	beforeEach(() => {
		noArgsQueryRoute = 'getMySubscription';
	});

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

describe('fetchCheckoutGate account scoping', () => {
	test('an account switch during the query cancels the stale gate', async () => {
		const query = deferred<{
			eligibility: string;
			checkoutEnabled: boolean;
			reason: string;
			mode: unknown;
		}>();
		gateBehavior = () => {
			currentUser = userB();
			return query.promise;
		};
		const pending = fetchCheckoutGate('user-a');
		query.resolve({
			eligibility: 'purchasable',
			checkoutEnabled: true,
			reason: '',
			mode: 'test_mode'
		});
		await expect(pending).rejects.toThrow('This billing action was cancelled.');
	});

	test('a caller bound to a different account never issues the query', async () => {
		await expect(fetchCheckoutGate('user-b')).rejects.toThrow('This billing action was cancelled.');
		const queries = convexCalls.filter((call) => call.route === 'checkoutEligibility');
		expect(queries).toEqual([]);
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
