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
		...overrides
	};
}

import type { DodoCheckoutEvent } from '@/lib/pricing/checkout-overlay';

type OverlayEvent = DodoCheckoutEvent;

type CheckoutStatusResult = {
	attemptId: string;
	status: string;
	activated?: boolean;
	checkout_url?: string;
};

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
	statusDeferred: Deferred<CheckoutStatusResult> | null;
	statusResult: CheckoutStatusResult;
	statusFailures: number;
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
	createCheckout: async (tier: string, interval: string) => {
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

	test('closing an unconfirmed checkout retains status recovery after timeout', async () => {
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
			expect(findButton('Check payment status').disabled).toBe(false);
			now += 31_000;
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 2_600));
			});
			expect(text()).toContain('We could not confirm');
			expect(findButton('Check payment status').disabled).toBe(false);
			expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(true);
			expect(current.checkoutCalls).toEqual([{ tier: 'team', interval: 'monthly' }]);
		} finally {
			clock.mockRestore();
		}
	}, 15_000);

	test('closing an unpaid checkout offers same-link resume with no new create', async () => {
		signedIn();
		await mount();
		await click(findButton('Get Team'));
		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/cks_unpaid',
				attemptId: 'attempt-unpaid'
			});
		});
		current.statusResult = {
			attemptId: 'attempt-unpaid',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/cks_unpaid'
		};
		await act(async () => {
			current.overlayOpenings[0]?.handler?.({ event_type: 'checkout.closed' });
		});
		expect(text()).toContain('We could not confirm');
		expect(findButton('Continue checkout').disabled).toBe(false);
		expect(findButton('Check payment status').disabled).toBe(false);

		const storedAttempt = sessionMemory.get('spikonado_pricing_attempt');
		await click(findButton('Continue checkout'));
		expect(sessionMemory.get('spikonado_pricing_attempt')).toBe(storedAttempt);
		expect(current.overlayOpenings.map((entry) => entry.url)).toEqual([
			'https://checkout.example/session/cks_unpaid',
			'https://checkout.example/session/cks_unpaid'
		]);
		expect(current.checkoutCalls).toEqual([{ tier: 'team', interval: 'monthly' }]);

		// Closing the resumed overlay keeps the same pending recovery available.
		await act(async () => {
			current.overlayOpenings[1]?.handler?.({ event_type: 'checkout.closed' });
		});
		expect(findButton('Continue checkout').disabled).toBe(false);
	}, 15_000);

	test('reload recovery of an unpaid attempt offers the same checkout link', async () => {
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: 'user-a',
				attemptId: 'attempt-reload',
				tierId: 'team',
				interval: 'monthly',
				startedAt: Date.now()
			})
		);
		signedIn();
		current.statusResult = {
			attemptId: 'attempt-reload',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/cks_reload'
		};
		await mount();
		expect(current.statusCalls).toEqual(['attempt-reload']);
		expect(findButton('Continue checkout').disabled).toBe(false);

		await click(findButton('Continue checkout'));
		expect(current.overlayOpenings.map((entry) => entry.url)).toEqual([
			'https://checkout.example/session/cks_reload'
		]);
		expect(current.checkoutCalls).toEqual([]);
		await click(findButton('Sign out'));
		expect(current.overlayCloses).toBeGreaterThan(0);
	}, 15_000);

	test('an account switch before resume never reopens the old account checkout', async () => {
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: 'user-a',
				attemptId: 'attempt-switch',
				tierId: 'team',
				interval: 'monthly',
				startedAt: Date.now()
			})
		);
		signedIn('user-a');
		current.statusResult = {
			attemptId: 'attempt-switch',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/cks_switch'
		};
		await mount();
		expect(findButton('Continue checkout').disabled).toBe(false);

		// user-b signs in after the resume UI was rendered for user-a.
		signedIn('user-b');
		await click(findButton('Continue checkout'));
		expect(current.overlayOpenings).toEqual([]);
		expect(current.checkoutCalls).toEqual([]);
	}, 15_000);

	test('an SDK error followed by close keeps status recovery, not a payment failure', async () => {
		signedIn();
		await mount();
		await click(findButton('Get Team'));
		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/cks_err',
				attemptId: 'attempt-err'
			});
		});
		current.statusResult = {
			attemptId: 'attempt-err',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/cks_err'
		};
		await act(async () => {
			current.overlayOpenings[0]?.handler?.({ event_type: 'checkout.error' });
			current.overlayOpenings[0]?.handler?.({ event_type: 'checkout.closed' });
		});
		expect(text()).toContain('We could not confirm your Team payment yet');
		expect(findButton('Continue checkout').disabled).toBe(false);
		expect(findButton('Check payment status').disabled).toBe(false);
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(true);
		expect(current.checkoutCalls).toEqual([{ tier: 'team', interval: 'monthly' }]);
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
		await click(findButton('Check payment status'));
		expect(current.statusCalls).toEqual(['recoverable']);
		expect(current.checkoutCalls).toEqual([]);
	});

	test('manual status checking falls back to an account refresh when the stored attempt is gone', async () => {
		signedIn();
		await mount();
		await click(findButton('Get Team'));
		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/cks_gone',
				attemptId: 'attempt-gone'
			});
		});
		current.statusResult = {
			attemptId: 'attempt-gone',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/cks_gone'
		};
		await act(async () => {
			current.overlayOpenings[0]?.handler?.({ event_type: 'checkout.closed' });
		});
		expect(text()).toContain('We could not confirm');

		// The stored attempt reference is gone (session eviction): the manual
		// check refreshes account state instead of a status lookup or a new
		// checkout.
		sessionMemory.clear();
		await click(findButton('Check payment status'));
		expect(current.subscriptionExpectedAccounts).toEqual(['user-a', 'user-a']);
		expect(current.statusCalls).toEqual(['attempt-gone']);
		expect(current.checkoutCalls).toEqual([{ tier: 'team', interval: 'monthly' }]);
	}, 15_000);

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

	test('terminal recovery retains its reference through a failed account refresh and retries', async () => {
		signedIn();
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: 'user-a',
				attemptId: 'terminal-retry',
				tierId: 'team',
				interval: 'monthly',
				startedAt: Date.now()
			})
		);
		current.statusResult = { attemptId: 'terminal-retry', status: 'expired' };
		queueSubscriptions(subscription(), new Error('Temporary refresh failure'), subscription());
		await mount();
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(true);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 2_600));
		});
		expect(current.statusCalls).toEqual(['terminal-retry', 'terminal-retry']);
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(false);
		expect(text()).toContain('did not complete');
		expect(findButton('Get Team').disabled).toBe(false);
	}, 15_000);

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
		const status = deferred<CheckoutStatusResult>();
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
