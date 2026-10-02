import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MySubscription } from '@/lib/pricing/billing-client';
import type { PublicPricingCatalog } from '@/lib/convex/api';
import PricingPlans from './pricing-plans.tsx';

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
};

// Enough rounds for the component's chained awaits (initialize, account check,
// query/action, state update) to settle; an explicit count keeps the coverage
// of each call site visible instead of hidden behind a magic default.
function flushMicrotasks(times: number): Promise<void> {
	let chain = Promise.resolve();
	for (let index = 0; index < times; index += 1) chain = chain.then(() => {});
	return chain;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const catalog: PublicPricingCatalog = {
	plans: [
		{
			id: 'free',
			label: 'Free',
			weeklyUsageDollars: 5,
			monthlyUsageDollars: 15,
			description: null,
			features: [],
			displayOrder: 0,
			highlighted: false,
			prices: { monthly: null, annual: null }
		},
		{
			id: 'team',
			label: 'Team',
			weeklyUsageDollars: 25,
			monthlyUsageDollars: 75,
			description: 'For engineering teams.',
			features: [],
			displayOrder: 10,
			highlighted: true,
			prices: {
				monthly: {
					productId: 'prod_team_monthly',
					name: 'Team Monthly',
					amountMinor: 2_000,
					currency: 'USD',
					paymentFrequencyCount: 1,
					paymentFrequencyInterval: 'Month'
				},
				annual: {
					productId: 'prod_team_annual',
					name: 'Team Annual',
					amountMinor: 20_000,
					currency: 'USD',
					paymentFrequencyCount: 1,
					paymentFrequencyInterval: 'Year'
				}
			}
		}
	]
};

function subscription(overrides: Partial<MySubscription> = {}): MySubscription {
	return {
		tier: 'free',
		tierLabel: 'Free',
		billingManaged: false,
		checkoutEligibility: 'purchasable',
		...overrides
	};
}

import type { DodoCheckoutEvent } from '@/lib/pricing/checkout-overlay';

type OverlayEvent = DodoCheckoutEvent;

const sessionMemory = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
	value: {
		getItem: (key: string) => sessionMemory.get(key) ?? null,
		setItem: (key: string, value: string) => void sessionMemory.set(key, value),
		removeItem: (key: string) => void sessionMemory.delete(key)
	},
	configurable: true
});

let portalAssigns: string[] = [];
Object.defineProperty(window.location, 'assign', {
	value: (url: string) => {
		portalAssigns.push(url);
	},
	configurable: true,
	writable: true
});

type PricingMocks = {
	clientState: {
		user: { id: string; email: string } | null;
		isConfigured: boolean;
	};
	// When set, initializePricingBilling awaits this before resolving, letting a
	// test change the account while initialization is genuinely in flight.
	initializeDeferred: Deferred<void> | null;
	initialAccount: { id: string; email: string } | null;
	signOutError: Error | null;
	subscriptionResults: Array<MySubscription | Error>;
	subscriptionDeferreds: Array<Deferred<MySubscription>>;
	subscriptionExpectedAccounts: Array<string | undefined>;
	checkoutCalls: { tier: string; interval: string }[];
	checkoutDeferred: Deferred<{ checkoutUrl: string; attemptId: string }>;
	portalDeferred: Deferred<string>;
	portalCalls: number;
	statusCalls: string[];
	statusExpectedAccounts: Array<string | undefined>;
	statusDeferred: Deferred<{ attemptId: string; status: string; activated?: boolean }> | null;
	statusResult: { attemptId: string; status: string; activated?: boolean };
	statusFailures: number;
	gateState: { checkoutEnabled: boolean; mode?: 'test' | 'live' };
	overlayOpenings: { url: string; handler?: (event: OverlayEvent) => void }[];
	overlayCloses: number;
};

// Module mocks below read through this handle; beforeEach installs a fresh
// value so a mounted component can never observe another test's mocks.
let current: PricingMocks;

let container: HTMLDivElement;
let root: Root;

function signedIn(id = 'user-a') {
	current.clientState.user = { id, email: `${id}@example.com` };
}

function queueSubscriptions(...results: Array<MySubscription | Error>) {
	current.subscriptionResults = [...results];
}

function queueSubscriptionDeferreds(...results: Array<Deferred<MySubscription>>) {
	current.subscriptionDeferreds = [...results];
}

function nextSubscription(): Promise<MySubscription> {
	const pending = current.subscriptionDeferreds;
	if (pending.length > 0) {
		const next = pending.length > 1 ? pending.shift() : pending[0];
		return next!.promise;
	}
	const results = current.subscriptionResults;
	const next = results.length > 1 ? results.shift() : results[0];
	if (!next) return Promise.resolve(subscription());
	if (next instanceof Error) return Promise.reject(next);
	return Promise.resolve(next);
}

mock.module('@/lib/pricing/billing-client', () => ({
	initializePricingBilling: async () => {
		if (current.initializeDeferred) await current.initializeDeferred.promise;
		return {
			convex: {},
			// Live account reads go through the auth client, like the real client.
			auth: { getUser: () => current.clientState.user },
			user: current.initialAccount ?? current.clientState.user,
			isReady: true,
			isConfigured: current.clientState.isConfigured,
			error: null
		};
	},
	fetchPublicPricingCatalog: async () => catalog,
	fetchMySubscription: async (expectedAccountId?: string) => {
		current.subscriptionExpectedAccounts.push(expectedAccountId);
		const result = await nextSubscription();
		if (expectedAccountId && current.clientState.user?.id !== expectedAccountId)
			throw new Error('This billing action was cancelled.');
		return result;
	},
	fetchCheckoutGate: async () => {
		const sub = current.subscriptionResults[0];
		const eligibility =
			sub && !(sub instanceof Error) && sub.checkoutEligibility
				? sub.checkoutEligibility
				: 'purchasable';
		return {
			eligibility: eligibility as 'purchasable',
			checkoutEnabled: current.gateState.checkoutEnabled,
			reason: '',
			mode: current.gateState.mode
		};
	},
	createCheckout: async (tier: string, interval: string) => {
		if (!current.gateState.checkoutEnabled)
			throw new Error('New purchases are temporarily unavailable.');
		const checkout = current.checkoutCalls.find(
			(call) => call.tier === tier && call.interval === interval
		);
		// Server-side revalidation replaces the client: it rejects any repeated
		// or superseded creation for the same selection. The stored attempt
		// reference is written only when creation succeeds, mirroring the real
		// client persisting the attempt after a valid session response.
		if (checkout) throw new Error('A checkout session was already created for this selection.');
		current.checkoutCalls.push({ tier, interval });
		const result = await current.checkoutDeferred.promise;
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: current.clientState.user?.id,
				attemptId: result.attemptId,
				tierId: tier,
				interval,
				startedAt: Date.now()
			})
		);
		return result;
	},
	openCustomerPortal: async (expectedAccountId?: string) => {
		current.portalCalls += 1;
		const result = await current.portalDeferred.promise;
		if (expectedAccountId && current.clientState.user?.id !== expectedAccountId) {
			throw new Error('This billing action was cancelled.');
		}
		return result;
	},
	fetchCheckoutStatus: async (attemptId: string, expectedAccountId?: string) => {
		current.statusCalls.push(attemptId);
		current.statusExpectedAccounts.push(expectedAccountId);
		if (current.statusFailures-- > 0) throw new Error('Temporary provider outage');
		const result = current.statusDeferred
			? await current.statusDeferred.promise
			: current.statusResult;
		if (expectedAccountId && current.clientState.user?.id !== expectedAccountId) {
			throw new Error('This billing action was cancelled.');
		}
		return result;
	},
	signInForPricing: async () => {},
	signOutOfPricing: async () => {
		if (current.signOutError) throw current.signOutError;
		current.clientState.user = null;
	}
}));

mock.module('@/lib/pricing/checkout-overlay', () => ({
	createCheckoutOverlay: () => ({
		open: (url: string, handler?: (event: OverlayEvent) => void) => {
			current.overlayOpenings.push({ url, handler });
			return 'overlay' as const;
		},
		close: () => {
			current.overlayCloses += 1;
		}
	})
}));

mock.module('@/lib/analytics/bootstrap', () => ({
	captureAnalyticsEvent: () => {}
}));

function text(): string {
	return container.textContent ?? '';
}

function findButton(label: string | RegExp): HTMLButtonElement {
	const buttons = Array.from(container.querySelectorAll('button'));
	const match = buttons.find((button) =>
		typeof label === 'string'
			? button.textContent?.includes(label)
			: label.test(button.textContent ?? '')
	);
	if (!match)
		throw new Error(`No button matching ${String(label)}. Found: ${text().slice(0, 400)}`);
	return match;
}

async function click(button: HTMLButtonElement) {
	await act(async () => {
		button.click();
	});
}

async function mount(initialCatalog: PublicPricingCatalog | null = catalog) {
	await act(async () => {
		root.render(createElement(PricingPlans, { initialCatalog }));
	});
}

async function unmount() {
	await act(async () => {
		root.unmount();
	});
}

beforeEach(() => {
	current = {
		clientState: { user: null, isConfigured: true },
		initializeDeferred: null,
		initialAccount: null,
		signOutError: null,
		subscriptionResults: [subscription()],
		subscriptionDeferreds: [],
		subscriptionExpectedAccounts: [],
		checkoutCalls: [],
		checkoutDeferred: deferred(),
		portalDeferred: deferred(),
		portalCalls: 0,
		statusCalls: [],
		statusExpectedAccounts: [],
		statusDeferred: null,
		statusResult: { attemptId: 'attempt-1', status: 'pending' },
		statusFailures: 0,
		gateState: { checkoutEnabled: true, mode: 'test' },
		overlayOpenings: [],
		overlayCloses: 0
	};
	portalAssigns = [];
	sessionMemory.clear();
	window.history.replaceState({}, '', '/pricing');
	container = document.createElement('div');
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	current.checkoutDeferred.resolve({
		checkoutUrl: 'https://checkout.example/session/cks_z',
		attemptId: 'z'
	});
	current.portalDeferred.resolve('https://portal.example/');
	current.statusDeferred?.resolve({ attemptId: 'z', status: 'expired' });
	try {
		await unmount();
	} catch {
		// Already unmounted by the test.
	}
	container.remove();
	mock.clearAllMocks();
});

describe('pricing plans orchestration', () => {
	test('runs checkout for the signed-in account and confirms via server state only', async () => {
		signedIn();
		await mount();
		expect(text()).toContain('dev@example.com'.replace('dev', 'user-a'));

		await click(findButton('Get Team'));
		expect(current.checkoutCalls).toEqual([{ tier: 'team', interval: 'monthly' }]);

		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/cks_a',
				attemptId: 'attempt-1'
			});
		});
		expect(current.overlayOpenings.map((entry) => entry.url)).toEqual([
			'https://checkout.example/session/cks_a'
		]);
		expect(text()).toContain('Complete checkout in the overlay');

		queueSubscriptions(subscription({ tier: 'team', tierLabel: 'Team', billingManaged: true }));
		current.statusResult = { attemptId: 'attempt-1', status: 'succeeded', activated: true };
		await act(async () => {
			current.overlayOpenings[0]?.handler?.({ event_type: 'checkout.closed' });
		});
		// Let the activation poll observe the server-confirmed tier.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 2_600));
		});
		expect(text()).toContain('Team is active');
	});

	test('closing an unconfirmed checkout retains recovery and blocks another purchase after timeout', async () => {
		let now = Date.now();
		const clock = spyOn(Date, 'now').mockImplementation(() => now);
		try {
			signedIn();
			await mount();
			await click(findButton('Get Team'));
			await act(async () => {
				current.checkoutDeferred.resolve({
					checkoutUrl: 'https://checkout.example/session/cks_pending',
					attemptId: 'pending'
				});
			});
			await act(async () => {
				current.overlayOpenings[0]?.handler?.({ event_type: 'checkout.closed' });
			});
			expect(findButton('Payment confirming').disabled).toBe(true);
			now += 31_000;
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 2_600));
			});
			expect(text()).toContain('We could not confirm');
			expect(findButton('Check payment status').disabled).toBe(false);
			expect(findButton('Payment confirming').disabled).toBe(true);
			expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(true);
			expect(current.checkoutCalls).toEqual([{ tier: 'team', interval: 'monthly' }]);
		} finally {
			clock.mockRestore();
		}
	}, 15_000);

	test('a forged checkout=return URL never claims payment without server confirmation', async () => {
		signedIn();
		window.history.replaceState({}, '', '/pricing?checkout=return&tier=team');
		queueSubscriptions(subscription());
		await mount();
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 2_600));
		});
		expect(text()).not.toContain('Payment received');
		expect(text()).not.toContain('Team is active');
	}, 15_000);

	test('sign-out invalidates a delayed checkout: no link opens and no stale UI updates', async () => {
		signedIn();
		await mount();

		await click(findButton('Get Team'));
		expect(current.checkoutCalls).toHaveLength(1);

		await click(findButton('Sign out'));
		expect(current.overlayCloses).toBeGreaterThan(0);

		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/cks_a',
				attemptId: 'attempt-1'
			});
		});
		expect(current.overlayOpenings).toEqual([]);
		expect(text()).not.toContain('Signed in as');
	});

	test('selecting another interval while the overlay is open replaces the checkout', async () => {
		signedIn();
		await mount();

		await click(findButton('Get Team'));
		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/cks_a',
				attemptId: 'attempt-1'
			});
		});
		expect(current.overlayOpenings).toHaveLength(1);
		expect(text()).toContain('Complete checkout in the overlay');

		// The open overlay does not block a replacement selection. Picking the
		// same plan under another interval re-runs checkout for that selection
		// and closes the old overlay.
		current.checkoutDeferred = deferred();
		await act(async () => {
			container.querySelector<HTMLInputElement>('input[value="annual"]')!.click();
		});
		await click(findButton('Checkout opened'));
		expect(current.overlayCloses).toBeGreaterThan(0);
		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/cks_b',
				attemptId: 'attempt-2'
			});
		});
		expect(current.checkoutCalls).toEqual([
			{ tier: 'team', interval: 'monthly' },
			{ tier: 'team', interval: 'annual' }
		]);
		expect(current.overlayOpenings.map((entry) => entry.url)).toEqual([
			'https://checkout.example/session/cks_a',
			'https://checkout.example/session/cks_b'
		]);
	});

	test('repair-required accounts cannot start checkout and reach the portal instead', async () => {
		signedIn();
		queueSubscriptions(
			subscription({
				tier: 'free',
				billingManaged: true,
				checkoutEligibility: 'repair_required',
				accessPhase: 'ended'
			})
		);
		await mount();

		expect(text()).toContain('payment for your subscription needs attention');
		const button = findButton('Repair in billing portal');
		expect(button.disabled).toBe(true);
		expect(current.checkoutCalls).toEqual([]);

		current.portalDeferred.resolve('https://portal.example/session');
		await click(findButton('Manage billing'));
		expect(current.portalCalls).toBe(1);
	});

	test('checkout-disabled accounts see portal guidance and no checkout buttons', async () => {
		signedIn();
		queueSubscriptions(
			subscription({ billingManaged: true, checkoutEligibility: 'checkout_disabled' })
		);
		await mount();
		expect(text()).toContain('New purchases are temporarily unavailable');
		expect(findButton('Checkout unavailable').disabled).toBe(true);
	});

	test('reload recovery consults the server attempt status, never the URL', async () => {
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: 'user-a',
				attemptId: 'attempt-1',
				tierId: 'team',
				interval: 'monthly',
				startedAt: Date.now()
			})
		);
		signedIn();
		// Provider "succeeded" without an activated flag must not claim activation.
		current.statusResult = { attemptId: 'attempt-1', status: 'succeeded', activated: false };
		queueSubscriptions(subscription());
		await mount();
		expect(current.statusCalls).toEqual(['attempt-1']);
		// The poll must not announce activation from the URL, the provider status,
		// or an unconfirmed attempt.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 2_600));
		});
		expect(text()).not.toContain('Payment received');
		expect(text()).not.toContain('Team is active');
	}, 15_000);

	test('an activated attempt confirms activation through the server state', async () => {
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: 'user-a',
				attemptId: 'attempt-2',
				tierId: 'team',
				interval: 'monthly',
				startedAt: Date.now()
			})
		);
		signedIn();
		current.statusResult = { attemptId: 'attempt-2', status: 'succeeded', activated: true };
		queueSubscriptions(
			subscription(),
			subscription({ tier: 'team', tierLabel: 'Team', billingManaged: true })
		);
		await mount();
		expect(current.statusCalls).toEqual(['attempt-2']);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 2_600));
		});
		expect(text()).toContain('Team is active');
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(false);
	}, 15_000);

	test('recovery retries a transient lookup failure using the live cached-client account', async () => {
		signedIn('user-b');
		current.initialAccount = { id: 'user-a', email: 'user-a@example.com' };
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: 'user-b',
				attemptId: 'retry',
				tierId: 'team',
				interval: 'monthly',
				startedAt: Date.now()
			})
		);
		current.statusFailures = 1;
		current.statusResult = { attemptId: 'retry', status: 'succeeded', activated: true };
		queueSubscriptions(
			subscription(),
			subscription({ tier: 'team', tierLabel: 'Team', billingManaged: true })
		);
		await mount();
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 2_600));
		});
		expect(current.statusExpectedAccounts).toEqual(['user-b', 'user-b']);
		expect(text()).toContain('Team is active');
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(false);
	}, 15_000);

	test('failed sign-out keeps the account and its recoverable checkout usable', async () => {
		signedIn();
		current.signOutError = new Error('Network unavailable');
		await mount();
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: 'user-a',
				attemptId: 'recoverable',
				tierId: 'team',
				interval: 'monthly',
				startedAt: Date.now()
			})
		);
		await click(findButton('Sign out'));
		expect(text()).toContain('Could not sign out');
		expect(text()).toContain('user-a@example.com');
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(true);
		expect(findButton('Payment confirming').disabled).toBe(true);
		await click(findButton('Check payment status'));
		expect(current.statusCalls).toEqual(['recoverable']);
		expect(current.checkoutCalls).toEqual([]);
	});

	test('manual status checking refreshes account eligibility without a stored attempt', async () => {
		signedIn();
		queueSubscriptions(subscription({ checkoutEligibility: 'confirmation_pending' }));
		await mount();
		queueSubscriptions(subscription());
		await click(findButton('Check payment status'));
		expect(current.subscriptionExpectedAccounts).toEqual(['user-a', 'user-a']);
		expect(findButton('Get Team').disabled).toBe(false);
		expect(current.statusCalls).toEqual([]);
		expect(current.checkoutCalls).toEqual([]);
	});

	test('recovery of an expired attempt invites a new checkout', async () => {
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: 'user-a',
				attemptId: 'attempt-9',
				tierId: 'team',
				interval: 'monthly',
				startedAt: Date.now() - 60_000
			})
		);
		signedIn();
		current.statusResult = { attemptId: 'attempt-9', status: 'expired' };
		await mount();
		expect(current.statusCalls).toEqual(['attempt-9']);
		expect(text()).toContain('did not complete');
	});

	test('attempts from another account are ignored after sign-in switches users', async () => {
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: 'user-other',
				attemptId: 'attempt-foreign',
				tierId: 'team',
				interval: 'monthly',
				startedAt: Date.now()
			})
		);
		signedIn('user-a');
		await mount();
		expect(current.statusCalls).toEqual([]);
	});

	test('sign-out invalidates a delayed portal open: no navigation and no stale UI', async () => {
		signedIn();
		queueSubscriptions(subscription({ tier: 'team', tierLabel: 'Team', billingManaged: true }));
		await mount();

		await click(findButton('Manage billing'));
		expect(current.portalCalls).toBe(1);

		await click(findButton('Sign out'));

		await act(async () => {
			current.portalDeferred.resolve('https://portal.example/session');
			await Promise.resolve();
		});
		expect(portalAssigns).toEqual([]);
		expect(text()).not.toContain('Signed in as');
	});

	test('a checkout network failure surfaces an error and no overlay opens', async () => {
		signedIn();
		await mount();

		await click(findButton('Get Team'));
		expect(current.checkoutCalls).toHaveLength(1);

		await act(async () => {
			current.checkoutDeferred.reject(new Error('Network request failed'));
			await Promise.resolve();
		});
		expect(current.overlayOpenings).toEqual([]);
		expect(text()).toContain('Network request failed');
	});

	test('unmounting during checkout closes the overlay and ignores the result', async () => {
		signedIn();
		await mount();

		await click(findButton('Get Team'));
		expect(current.checkoutCalls).toHaveLength(1);

		await unmount();
		expect(current.overlayCloses).toBeGreaterThan(0);

		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/cks_late',
				attemptId: 'attempt-late'
			});
			await Promise.resolve();
		});
		expect(current.overlayOpenings).toEqual([]);
	});

	test('checkout-disabled gate blocks checkout even when subscription eligibility is purchasable', async () => {
		current.gateState.checkoutEnabled = false;
		signedIn();
		queueSubscriptions(subscription({ checkoutEligibility: 'purchasable' }));
		await mount();

		await click(findButton('Get Team'));
		await act(async () => {
			await Promise.resolve();
		});
		expect(current.checkoutCalls).toEqual([]);
		expect(current.overlayOpenings).toEqual([]);
		expect(text()).toContain('New purchases are temporarily unavailable');
	});

	test('an account switch during initialization never opens the old account checkout', async () => {
		signedIn('user-a');
		await mount();

		// Hold initialization in flight so the account can switch while the
		// click's checkout is still awaiting the client.
		current.initializeDeferred = deferred();
		await act(async () => {
			findButton('Get Team').click();
		});
		await act(async () => {
			await flushMicrotasks(6);
		});
		expect(current.checkoutCalls).toEqual([]);

		// The click is still awaiting initialization; switch the account now.
		signedIn('user-b');
		current.initializeDeferred.resolve();
		current.initializeDeferred = null;
		await act(async () => {
			await flushMicrotasks(6);
		});
		expect(current.checkoutCalls).toEqual([]);
		expect(current.overlayOpenings).toEqual([]);
	});

	test('an account switch during a delayed subscription query drops the stale result', async () => {
		signedIn('user-a');
		const teamQuery = deferred<MySubscription>();
		queueSubscriptionDeferreds(teamQuery);
		await mount();
		await act(async () => {
			await flushMicrotasks(6);
		});

		// user-b signs in while the mount-time query is in flight.
		signedIn('user-b');
		await act(async () => {
			teamQuery.resolve(subscription({ tier: 'team', tierLabel: 'Team', billingManaged: true }));
			await flushMicrotasks(6);
		});
		expect(text()).not.toContain('Team is active');

		expect(text()).not.toContain('Current plan: Team');
		expect(text()).toContain('This billing action was cancelled.');
	});

	test('an account switch during a delayed status check drops the stale result', async () => {
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: 'user-a',
				attemptId: 'attempt-1',
				tierId: 'team',
				interval: 'monthly',
				startedAt: Date.now()
			})
		);
		signedIn('user-a');
		queueSubscriptions(subscription({ checkoutEligibility: 'confirmation_pending' }));
		const status = deferred<{ attemptId: string; status: string; activated?: boolean }>();
		current.statusDeferred = status;
		await mount();
		expect(current.statusCalls).toEqual(['attempt-1']);
		expect(current.statusExpectedAccounts).toEqual(['user-a']);

		// user-b signs in while the check is in flight.
		signedIn('user-b');
		await act(async () => {
			status.resolve({
				attemptId: 'attempt-1',
				status: 'succeeded',
				activated: true
			});
			await flushMicrotasks(6);
		});
		expect(text()).not.toContain('Team is active');

		expect(current.overlayOpenings).toEqual([]);
	});

	test('an account switch during a delayed portal open never navigates', async () => {
		signedIn('user-a');
		queueSubscriptions(subscription({ tier: 'team', tierLabel: 'Team', billingManaged: true }));
		await mount();

		expect(text()).toContain('Signed in as user-a@example.com');
		await click(findButton('Manage billing'));
		expect(current.portalCalls).toBe(1);

		// user-b signs in while the portal action is in flight.
		signedIn('user-b');
		await act(async () => {
			current.portalDeferred.resolve('https://portal.example/first');
			await flushMicrotasks(6);
		});
		expect(portalAssigns).toEqual([]);

		// The stale portal URL was not navigated to.
		expect(text()).not.toContain('Opening billing portal');
	});
});
