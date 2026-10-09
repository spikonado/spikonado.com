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
	catalogDeferred: Deferred<PublicPricingCatalog> | null;
	initialAccount: { id: string; email: string } | null;
	signOutError: Error | null;
	signOutDeferred: Deferred<void> | null;
	subscriptionResults: Array<MySubscription | Error>;
	subscriptionDeferreds: Array<Deferred<MySubscription>>;
	subscriptionExpectedAccounts: Array<string | undefined>;
	checkoutCalls: { tier: string; interval: string }[];
	checkoutExpectedAccounts: Array<string | undefined>;
	checkoutDeferred: Deferred<{ checkoutUrl: string; attemptId: string }>;
	portalDeferred: Deferred<string>;
	portalCalls: number;
	statusCalls: string[];
	statusExpectedAccounts: Array<string | undefined>;
	statusDeferred: Deferred<CheckoutStatusResult> | null;
	statusResult: CheckoutStatusResult;
	statusFailures: number;
};

// Module mocks below read through this handle; beforeEach installs a fresh
// value so a mounted component can never observe another test's mocks.
let current: PricingMocks;

let container: HTMLDivElement;
let root: Root;

function signedIn(id = 'user-a') {
	current.clientState.user = { id, email: `${id}@example.com` };
}

function seedAttempt(attemptId: string, userId = 'user-a') {
	sessionMemory.set(
		'spikonado_pricing_attempt',
		JSON.stringify({ userId, attemptId, tierId: 'team', interval: 'monthly' })
	);
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
	fetchPublicPricingCatalog: async () => current.catalogDeferred?.promise ?? catalog,
	fetchMySubscription: async (expectedAccountId?: string) => {
		current.subscriptionExpectedAccounts.push(expectedAccountId);
		const result = await nextSubscription();
		if (expectedAccountId && current.clientState.user?.id !== expectedAccountId)
			throw new Error('This billing action was cancelled.');
		return result;
	},
	createCheckout: async (
		tier: string,
		interval: string,
		expectedAccountId?: string,
		isCurrent: () => boolean = () => true
	) => {
		const accountId = current.clientState.user?.id;
		if (!accountId || (expectedAccountId && accountId !== expectedAccountId) || !isCurrent()) {
			throw new Error('This billing action was cancelled.');
		}
		current.checkoutCalls.push({ tier, interval });
		current.checkoutExpectedAccounts.push(expectedAccountId);
		const result = await current.checkoutDeferred.promise;
		if (current.clientState.user?.id !== accountId || !isCurrent()) {
			throw new Error('This billing action was cancelled.');
		}
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: accountId,
				attemptId: result.attemptId,
				tierId: tier,
				interval
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
		if (current.signOutDeferred) await current.signOutDeferred.promise;
		if (current.signOutError) throw current.signOutError;
		current.clientState.user = null;
	}
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

function expectPlanButtonsBusy() {
	const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('article button'));
	expect(buttons).toHaveLength(catalog.plans.length);
	for (const button of buttons) expect(button.disabled).toBe(true);
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

async function restoreFromBrowserBack() {
	const event = new Event('pageshow');
	Object.defineProperty(event, 'persisted', { value: true });
	await act(async () => {
		window.dispatchEvent(event);
		await flushMicrotasks(40);
	});
}

beforeEach(() => {
	current = {
		clientState: { user: null, isConfigured: true },
		initializeDeferred: null,
		catalogDeferred: null,
		initialAccount: null,
		signOutError: null,
		signOutDeferred: null,
		subscriptionResults: [subscription()],
		subscriptionDeferreds: [],
		subscriptionExpectedAccounts: [],
		checkoutCalls: [],
		checkoutExpectedAccounts: [],
		checkoutDeferred: deferred(),
		portalDeferred: deferred(),
		portalCalls: 0,
		statusCalls: [],
		statusExpectedAccounts: [],
		statusDeferred: null,
		statusResult: { attemptId: 'attempt-1', status: 'pending' },
		statusFailures: 0
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
	current.signOutDeferred?.resolve();
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
	test('a saved attempt remains recoverable when checkout validation fails', async () => {
		signedIn();
		await mount();
		await click(findButton('Get Team'));
		await act(async () => {
			seedAttempt('attempt-invalid');
			current.checkoutDeferred.reject(new Error('Checkout session was not created.'));
		});
		expect(text()).toContain('Checkout session was not created.');
		expect(findButton('Check payment status').disabled).toBe(false);
		expect(container.querySelector('a[href^="mailto:aarav@spikonado.com"]')).not.toBeNull();
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(true);
		expect(portalAssigns).toEqual([]);
		current.statusResult = { attemptId: 'attempt-invalid', status: 'awaiting_payment' };
		await click(findButton('Check payment status'));
		expect(current.statusCalls).toEqual(['attempt-invalid']);
		expect(current.statusExpectedAccounts).toEqual(['user-a']);
		expect(current.checkoutCalls).toHaveLength(1);
	});

	test('checkout disables repeated clicks while billing initializes', async () => {
		signedIn();
		await mount();
		current.initializeDeferred = deferred();
		await click(findButton('Get Team'));
		expect(findButton('Starting checkout...').disabled).toBe(true);
		expect(findButton('Start free').disabled).toBe(true);
		await click(findButton('Starting checkout...'));
		await click(findButton('Start free'));
		expect(current.checkoutCalls).toEqual([]);
		expect(portalAssigns).toEqual([]);
		await act(async () => {
			current.initializeDeferred!.resolve();
			await flushMicrotasks(40);
		});
		expect(current.checkoutCalls).toEqual([{ tier: 'team', interval: 'monthly' }]);
	});

	test('live catalog refresh survives a billing action started from the build catalog', async () => {
		signedIn();
		current.catalogDeferred = deferred();
		await mount();
		await click(findButton('Get Team'));
		await act(async () => {
			current.catalogDeferred!.resolve({
				plans: catalog.plans.map((plan) => ({
					...plan,
					label: plan.id === 'team' ? 'Updated team' : plan.label
				}))
			});
		});
		expect(container.querySelectorAll('article h2')[1]?.textContent).toBe('Updated team');
	});

	test('renders live tier prices and descriptions for each billing interval', async () => {
		await mount();
		const [free, team] = Array.from(container.querySelectorAll('article'));
		expect(free?.querySelector('div p')?.textContent).toBe('$0');
		expect(free?.querySelector('div')?.nextElementSibling?.tagName).toBe('UL');
		expect(team?.querySelector('div p')?.textContent).toBe('$20');
		expect(team?.querySelector(':scope > p')?.textContent).toBe('For engineering teams.');

		await act(async () => {
			container.querySelector<HTMLInputElement>('input[value="annual"]')!.click();
		});
		expect(free?.querySelector('div p')?.textContent).toBe('$0');
		expect(team?.querySelector('div p')?.textContent).toBe('$200');
	});

	test('a plan click redirects to the hosted checkout for the signed-in account', async () => {
		signedIn();
		await mount();
		expect(text()).toContain('user-a@example.com');
		expect(portalAssigns).toEqual([]);

		await click(findButton('Get Team'));
		expect(current.checkoutCalls).toEqual([{ tier: 'team', interval: 'monthly' }]);
		expect(current.checkoutExpectedAccounts).toEqual(['user-a']);

		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/cks_a',
				attemptId: 'attempt-1'
			});
		});
		expect(portalAssigns).toEqual(['https://checkout.example/session/cks_a']);
		expect(JSON.parse(sessionMemory.get('spikonado_pricing_attempt')!)).toEqual({
			userId: 'user-a',
			attemptId: 'attempt-1',
			tierId: 'team',
			interval: 'monthly'
		});
		expect(current.statusCalls).toEqual([]);
		expect(text()).not.toContain('Team is active');
		expect(findButton('Redirecting to checkout...').disabled).toBe(true);
		expectPlanButtonsBusy();
		await act(async () => {
			container.querySelector<HTMLInputElement>('input[value="annual"]')!.click();
		});
		await click(findButton('Redirecting to checkout...'));
		expect(current.checkoutCalls).toHaveLength(1);
		expect(portalAssigns).toHaveLength(1);
	});

	test('mount recovery of an unconfirmed checkout retains status recovery after timeout', async () => {
		let now = Date.now();
		const clock = spyOn(Date, 'now').mockImplementation(() => now);
		try {
			signedIn();
			seedAttempt('pending');
			current.statusResult = { attemptId: 'pending', status: 'pending' };
			await mount();
			expect(findButton('Checking…').disabled).toBe(true);
			expect(current.statusCalls).toEqual(['pending']);
			now += 31_000;
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 2_600));
			});
			expect(text()).toContain('We could not confirm');
			expect(findButton('Check payment status').disabled).toBe(false);
			expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(true);
			expect(current.checkoutCalls).toEqual([]);
			expect(portalAssigns).toEqual([]);
		} finally {
			clock.mockRestore();
		}
	}, 15_000);

	test('browser back recovers an unpaid checkout and resumes only after a click', async () => {
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
		await restoreFromBrowserBack();
		expect(current.statusCalls).toEqual(['attempt-unpaid']);
		expect(current.statusExpectedAccounts).toEqual(['user-a']);
		expect(text()).toContain('We could not confirm');
		expect(findButton('Continue checkout').disabled).toBe(false);
		expect(findButton('Check payment status').disabled).toBe(false);
		expect(portalAssigns).toEqual(['https://checkout.example/session/cks_unpaid']);

		const storedAttempt = sessionMemory.get('spikonado_pricing_attempt');
		await click(findButton('Continue checkout'));
		expect(sessionMemory.get('spikonado_pricing_attempt')).toBe(storedAttempt);
		expect(portalAssigns).toEqual([
			'https://checkout.example/session/cks_unpaid',
			'https://checkout.example/session/cks_unpaid'
		]);
		expect(current.checkoutCalls).toEqual([{ tier: 'team', interval: 'monthly' }]);
		expect(current.statusCalls).toEqual(['attempt-unpaid', 'attempt-unpaid']);

		await restoreFromBrowserBack();
		expect(findButton('Continue checkout').disabled).toBe(false);
		expect(current.statusCalls).toEqual(['attempt-unpaid', 'attempt-unpaid', 'attempt-unpaid']);
		expect(current.statusExpectedAccounts).toEqual(['user-a', 'user-a', 'user-a']);
		expect(portalAssigns).toHaveLength(2);
		expect(current.checkoutCalls).toHaveLength(1);
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
		expect(portalAssigns).toEqual([]);

		await click(findButton('Continue checkout'));
		expect(portalAssigns).toEqual(['https://checkout.example/session/cks_reload']);
		expect(current.statusCalls).toEqual(['attempt-reload', 'attempt-reload']);
		expect(current.checkoutCalls).toEqual([]);
	}, 15_000);

	test('resume refreshes billing when its stored attempt disappears', async () => {
		sessionMemory.set(
			'spikonado_pricing_attempt',
			JSON.stringify({
				userId: 'user-a',
				attemptId: 'attempt-removed',
				tierId: 'team',
				interval: 'monthly',
				startedAt: Date.now()
			})
		);
		signedIn();
		current.statusResult = {
			attemptId: 'attempt-removed',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/cks_removed'
		};
		await mount();
		sessionMemory.delete('spikonado_pricing_attempt');
		await click(findButton('Continue checkout'));

		expect(text()).toContain('Your account billing status has been refreshed.');
		expect(text()).not.toContain('Continue checkout');
		expect(current.subscriptionExpectedAccounts).toEqual(['user-a', 'user-a']);
		expect(portalAssigns).toEqual([]);
		expect(current.checkoutCalls).toEqual([]);
	});

	test('an account switch before resume never redirects to the old account checkout', async () => {
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
		expect(portalAssigns).toEqual([]);
		expect(current.checkoutCalls).toEqual([]);
	}, 15_000);

	test('resume refreshes a changed server URL before an explicit redirect', async () => {
		signedIn();
		seedAttempt('url-changed');
		current.statusResult = {
			attemptId: 'url-changed',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/old'
		};
		await mount();
		current.statusResult = {
			...current.statusResult,
			checkout_url: 'https://checkout.example/session/new'
		};
		await click(findButton('Continue checkout'));
		expect(portalAssigns).toEqual([]);
		expect(findButton('Continue checkout').disabled).toBe(false);
		await click(findButton('Continue checkout'));
		expect(portalAssigns).toEqual(['https://checkout.example/session/new']);
		expect(current.statusCalls).toEqual(['url-changed', 'url-changed', 'url-changed']);
		expect(current.checkoutCalls).toEqual([]);
		expectPlanButtonsBusy();
	});

	test('resume recovers a replaced stored attempt instead of redirecting the old one', async () => {
		signedIn();
		seedAttempt('old-attempt');
		current.statusResult = {
			attemptId: 'old-attempt',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/old'
		};
		await mount();
		current.statusDeferred = deferred();
		await click(findButton('Continue checkout'));
		expectPlanButtonsBusy();
		seedAttempt('new-attempt');
		current.statusResult = {
			attemptId: 'new-attempt',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/new'
		};
		await act(async () => {
			const pending = current.statusDeferred!;
			current.statusDeferred = null;
			pending.resolve({
				attemptId: 'old-attempt',
				status: 'awaiting_payment',
				checkout_url: 'https://checkout.example/session/old'
			});
			await flushMicrotasks(40);
		});
		expect(portalAssigns).toEqual([]);
		expect(current.statusCalls).toEqual(['old-attempt', 'old-attempt', 'new-attempt']);
		await click(findButton('Continue checkout'));
		expect(portalAssigns).toEqual(['https://checkout.example/session/new']);
		expect(current.checkoutCalls).toEqual([]);
	});

	test('an account switch during delayed resume cancels navigation', async () => {
		signedIn();
		seedAttempt('resume-switch');
		current.statusResult = {
			attemptId: 'resume-switch',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/resume-switch'
		};
		await mount();
		current.statusDeferred = deferred();
		await click(findButton('Continue checkout'));
		expectPlanButtonsBusy();
		signedIn('user-b');
		await act(async () => {
			current.statusDeferred!.resolve(current.statusResult);
			await flushMicrotasks(40);
		});
		expect(portalAssigns).toEqual([]);
		expect(current.checkoutCalls).toEqual([]);
		expect(current.statusExpectedAccounts).toEqual(['user-a', 'user-a']);
	});

	test('a resume lookup failure keeps the saved attempt and recovery controls available', async () => {
		signedIn();
		seedAttempt('resume-error');
		current.statusResult = {
			attemptId: 'resume-error',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/resume-error'
		};
		await mount();
		current.statusFailures = 1;
		await click(findButton('Continue checkout'));
		expect(text()).toContain('Temporary provider outage');
		expect(findButton('Continue checkout').disabled).toBe(false);
		expect(findButton('Check payment status').disabled).toBe(false);
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(true);
		expect(portalAssigns).toEqual([]);
		expect(current.checkoutCalls).toEqual([]);
	});

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

		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/cks_a',
				attemptId: 'attempt-1'
			});
		});
		expect(portalAssigns).toEqual([]);
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(false);
		expect(text()).not.toContain('Signed in as');
	});

	test('an account switch during delayed checkout does not overwrite the new account attempt', async () => {
		signedIn();
		await mount();
		await click(findButton('Get Team'));
		expect(current.checkoutExpectedAccounts).toEqual(['user-a']);
		signedIn('user-b');
		seedAttempt('user-b-attempt', 'user-b');
		const storedAttempt = sessionMemory.get('spikonado_pricing_attempt');
		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/user-a',
				attemptId: 'user-a-attempt'
			});
			await flushMicrotasks(40);
		});
		expect(portalAssigns).toEqual([]);
		expect(sessionMemory.get('spikonado_pricing_attempt')).toBe(storedAttempt);
		expect(text()).toContain('This billing action was cancelled.');
	});

	test('pending sign-out invalidates checkout before the account changes', async () => {
		signedIn();
		await mount();
		await click(findButton('Get Team'));
		current.signOutDeferred = deferred();
		await click(findButton('Sign out'));
		expect(current.clientState.user?.id).toBe('user-a');
		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/stale',
				attemptId: 'stale'
			});
			await flushMicrotasks(40);
		});
		expect(portalAssigns).toEqual([]);
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(false);
		await act(async () => {
			current.signOutDeferred!.resolve();
		});
		expect(text()).not.toContain('Signed in as');
	});

	test('reload recovery consults the server attempt status, never the URL', async () => {
		window.history.replaceState({}, '', '/pricing?checkout=return&tier=team');
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
		seedAttempt('recoverable');
		current.statusResult = { attemptId: 'recoverable', status: 'awaiting_payment' };
		await mount();
		await click(findButton('Sign out'));
		expect(text()).toContain('Could not sign out');
		expect(text()).toContain('user-a@example.com');
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(true);
		await click(findButton('Check payment status'));
		expect(current.statusCalls).toEqual(['recoverable', 'recoverable']);
		expect(current.checkoutCalls).toEqual([]);
	});

	test('manual status checking falls back to an account refresh when the stored attempt is gone', async () => {
		signedIn();
		seedAttempt('attempt-gone');
		current.statusResult = {
			attemptId: 'attempt-gone',
			status: 'awaiting_payment',
			checkout_url: 'https://checkout.example/session/cks_gone'
		};
		await mount();
		expect(text()).toContain('We could not confirm');

		// The stored attempt reference is gone (session eviction): the manual
		// check refreshes account state instead of a status lookup or a new
		// checkout.
		sessionMemory.clear();
		await click(findButton('Check payment status'));
		expect(current.subscriptionExpectedAccounts).toEqual(['user-a', 'user-a']);
		expect(current.statusCalls).toEqual(['attempt-gone']);
		expect(current.checkoutCalls).toEqual([]);
		expect(portalAssigns).toEqual([]);
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
		expectPlanButtonsBusy();

		await click(findButton('Sign out'));

		await act(async () => {
			current.portalDeferred.resolve('https://portal.example/session');
			await Promise.resolve();
		});
		expect(portalAssigns).toEqual([]);
		expect(text()).not.toContain('Signed in as');
	});

	test('a portal network failure restores plan actions without navigating', async () => {
		signedIn();
		queueSubscriptions(subscription({ tier: 'team', tierLabel: 'Team', billingManaged: true }));
		await mount();
		await click(findButton('Manage billing'));
		expectPlanButtonsBusy();
		await act(async () => {
			current.portalDeferred.reject(new Error('Portal unavailable'));
		});
		expect(text()).toContain('Portal unavailable');
		expect(findButton('Manage billing').disabled).toBe(false);
		expect(findButton('Start free').disabled).toBe(false);
		expect(portalAssigns).toEqual([]);
	});

	test('a checkout network failure surfaces an error without navigation', async () => {
		signedIn();
		await mount();

		await click(findButton('Get Team'));
		expect(current.checkoutCalls).toHaveLength(1);

		await act(async () => {
			current.checkoutDeferred.reject(new Error('Network request failed'));
			await Promise.resolve();
		});
		expect(portalAssigns).toEqual([]);
		expect(text()).toContain('Network request failed');
		expect(findButton('Get Team').disabled).toBe(false);
	});

	test('unmounting during checkout ignores the result without storing or navigating', async () => {
		signedIn();
		await mount();

		await click(findButton('Get Team'));
		expect(current.checkoutCalls).toHaveLength(1);

		await unmount();

		await act(async () => {
			current.checkoutDeferred.resolve({
				checkoutUrl: 'https://checkout.example/session/cks_late',
				attemptId: 'attempt-late'
			});
			await Promise.resolve();
		});
		expect(portalAssigns).toEqual([]);
		expect(sessionMemory.has('spikonado_pricing_attempt')).toBe(false);
	});

	test('an account switch during initialization never creates the old account checkout', async () => {
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
		expect(portalAssigns).toEqual([]);
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
		expectPlanButtonsBusy();

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

		expect(portalAssigns).toEqual([]);
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
