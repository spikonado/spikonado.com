import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { CheckoutOverlay, DodoCheckoutEvent } from './checkout-overlay.ts';
import { createBillingOperations } from './operation.ts';
import {
	checkoutRequestFromSearch,
	pricingUrlWithoutCheckoutCommand,
	runCheckout,
	type CheckoutProgress
} from './start-checkout.ts';
import { clearPendingPricingAction } from './pending.ts';

type OverlayOpen = {
	url: string;
	handler?: (event: DodoCheckoutEvent) => void;
};

function fakeOverlay(throwsOnOpen = false): { openings: OverlayOpen[]; overlay: CheckoutOverlay } {
	const openings: OverlayOpen[] = [];
	return {
		openings,
		overlay: {
			open: (url: string, handler?: (event: DodoCheckoutEvent) => void) => {
				if (throwsOnOpen) throw new Error('overlay unavailable');
				openings.push({ url, handler });
				return 'overlay' as const;
			},
			close: () => {}
		}
	};
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

const signedInClient = {
	convex: {},
	auth: {},
	user: { id: 'user-a', email: 'a@example.com' },
	isReady: true,
	isConfigured: true,
	error: null
};

function mockBillingModule({
	client = signedInClient,
	checkout
}: {
	client?: typeof signedInClient | Promise<typeof signedInClient>;
	checkout: ReturnType<typeof deferred<{ checkoutUrl: string; attemptId: string }>>;
}) {
	mock.module('@/lib/pricing/billing-client', () => ({
		initializePricingBilling: () => client,
		fetchCheckoutGate: async () => ({
			eligibility: 'purchasable' as const,
			checkoutEnabled: true,
			reason: '',
			mode: 'test' as const
		}),
		signInForPricing: async () => {},
		createCheckout: () => checkout.promise
	}));
}

function collectProgress(events: CheckoutProgress[]) {
	return (progress: CheckoutProgress) => events.push(progress);
}

afterEach(() => {
	mock.restore();
	sessionMemory.clear();
	clearPendingPricingAction();
});

describe('checkoutRequestFromSearch', () => {
	test('reads tier and interval from checkout deep links', () => {
		expect(checkoutRequestFromSearch('?checkout=start&tier=team&interval=monthly')).toEqual({
			tierId: 'team',
			interval: 'monthly'
		});
		expect(checkoutRequestFromSearch('checkout=start&tier=team%2Fplus&interval=annual')).toEqual({
			tierId: 'team/plus',
			interval: 'annual'
		});
	});

	test('rejects malformed checkout links and unrelated commands', () => {
		expect(checkoutRequestFromSearch('?checkout=start')).toBeNull();
		expect(checkoutRequestFromSearch('?checkout=start&tier=&interval=monthly')).toBeNull();
		expect(checkoutRequestFromSearch('?checkout=start&tier=team&interval=weekly')).toBeNull();
		expect(checkoutRequestFromSearch('?checkout=return')).toBeNull();
		expect(checkoutRequestFromSearch('')).toBeNull();
	});
});

describe('pricingUrlWithoutCheckoutCommand', () => {
	test('consumes checkout parameters without removing unrelated state', () => {
		expect(
			pricingUrlWithoutCheckoutCommand(
				'https://spikonado.com/pricing?campaign=launch&checkout=start&tier=team&interval=annual#plans'
			)
		).toBe('/pricing?campaign=launch#plans');
	});
});

describe('runCheckout orchestration', () => {
	test('opens the overlay and reports progress for the owning account', async () => {
		const checkout = deferred<{ checkoutUrl: string; attemptId: string }>();
		mockBillingModule({ checkout });
		const { overlay, openings } = fakeOverlay();
		const ops = createBillingOperations();
		const guard = ops.begin('checkout', 'user-a', overlay);
		const events: CheckoutProgress[] = [];

		const run = runCheckout('team', 'monthly', {
			overlay,
			guard,
			emit: collectProgress(events)
		});
		checkout.resolve({ checkoutUrl: 'https://checkout.example/session/cks_a', attemptId: 'a1' });
		await run;

		expect(openings.map((entry) => entry.url)).toEqual(['https://checkout.example/session/cks_a']);
		expect(events.map((event) => event.status)).toEqual(['starting', 'starting', 'checkout_open']);
		expect(events.every((event) => event.accountId === 'user-a')).toBe(true);
	});

	test('a stale operation never opens the checkout URL and reports nothing', async () => {
		const checkout = deferred<{ checkoutUrl: string; attemptId: string }>();
		mockBillingModule({ checkout });
		const { overlay, openings } = fakeOverlay();
		const ops = createBillingOperations();
		const guard = ops.begin('checkout', 'user-a', overlay);
		const events: CheckoutProgress[] = [];

		const run = runCheckout('team', 'monthly', {
			overlay,
			guard,
			emit: collectProgress(events)
		});
		ops.bumpGeneration();
		checkout.resolve({ checkoutUrl: 'https://checkout.example/session/cks_a', attemptId: 'a1' });
		await run;

		expect(openings).toEqual([]);
		expect(events.map((event) => event.status)).toEqual(['starting']);
	});

	test('overlay events from a stale operation are ignored', async () => {
		const checkout = deferred<{ checkoutUrl: string; attemptId: string }>();
		mockBillingModule({ checkout });
		const { overlay, openings } = fakeOverlay();
		const ops = createBillingOperations();
		const guard = ops.begin('checkout', 'user-a', overlay);
		const events: CheckoutProgress[] = [];

		const run = runCheckout('team', 'monthly', {
			overlay,
			guard,
			emit: collectProgress(events)
		});
		checkout.resolve({ checkoutUrl: 'https://checkout.example/session/cks_a', attemptId: 'a1' });
		await run;

		ops.bumpGeneration();
		openings[0]?.handler?.({ event_type: 'checkout.closed' });
		expect(events.map((event) => event.status)).not.toContain('checkout_closed');
	});

	test('checkout creation failures surface as operation-bound errors', async () => {
		const checkout = deferred<{ checkoutUrl: string; attemptId: string }>();
		mockBillingModule({ checkout });
		const { overlay, openings } = fakeOverlay();
		const ops = createBillingOperations();
		const guard = ops.begin('checkout', 'user-a', overlay);
		const events: CheckoutProgress[] = [];

		const run = runCheckout('team', 'monthly', {
			overlay,
			guard,
			emit: collectProgress(events)
		});
		checkout.reject(new Error('Checkout is temporarily disabled.'));
		await run;

		expect(openings).toEqual([]);
		expect(events.at(-1)).toMatchObject({
			status: 'error',
			message: 'Checkout is temporarily disabled.',
			accountId: 'user-a'
		});
	});
});
