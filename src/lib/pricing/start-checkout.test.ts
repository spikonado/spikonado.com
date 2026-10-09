import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createBillingOperations } from './operation.ts';
import { readPendingPricingAction } from './pending.ts';
import {
	checkoutRequestFromSearch,
	pricingUrlWithoutCheckoutCommand,
	runCheckout,
	type CheckoutProgress
} from './start-checkout.ts';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

type Checkout = { checkoutUrl: string; attemptId: string };
const checkout: Checkout = {
	checkoutUrl: 'https://checkout.example/session/cks_a',
	attemptId: 'attempt-a'
};
const user = { id: 'user-a', email: 'a@example.com' };
const client = {
	auth: { getUser: () => user as typeof user | null },
	isConfigured: true,
	error: null as string | null
};
let initializeBehavior: () => Promise<typeof client>;
let createBehavior: () => Promise<Checkout>;
let signInBehavior: () => Promise<void>;

const initialize = mock(() => initializeBehavior());
const create = mock(() => createBehavior());
const signIn = mock(() => signInBehavior());
mock.module('@/lib/pricing/billing-client', () => ({
	initializePricingBilling: initialize,
	createCheckout: create,
	signInForPricing: signIn
}));

const redirects: string[] = [];
Object.defineProperty(window.location, 'assign', {
	value: (url: string) => redirects.push(url),
	configurable: true
});
const sessionMemory = new Map<string, string>();
const storage = {
	getItem: (key: string) => sessionMemory.get(key) ?? null,
	setItem: (key: string, value: string) => void sessionMemory.set(key, value),
	removeItem: (key: string) => void sessionMemory.delete(key)
};

function restoreStorage(): void {
	Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true });
}

beforeEach(() => {
	restoreStorage();
	sessionMemory.clear();
	redirects.length = 0;
	initialize.mockClear();
	create.mockClear();
	signIn.mockClear();
	initializeBehavior = async () => client;
	createBehavior = async () => checkout;
	signInBehavior = async () => {};
});

afterEach(restoreStorage);

describe('checkout navigation', () => {
	test('parses checkout commands and consumes only their URL parameters', () => {
		expect(checkoutRequestFromSearch('?checkout=start&tier=team%2Fplus&interval=annual')).toEqual({
			tierId: 'team/plus',
			interval: 'annual'
		});
		expect(checkoutRequestFromSearch('?checkout=resume&tier=team&interval=monthly')).toEqual({
			tierId: 'team',
			interval: 'monthly'
		});
		for (const search of [
			'?checkout=start',
			'?checkout=start&tier=&interval=monthly',
			'?checkout=start&tier=team&interval=weekly',
			'?checkout=return'
		]) {
			expect(checkoutRequestFromSearch(search)).toBeNull();
		}
		expect(
			pricingUrlWithoutCheckoutCommand(
				'https://spikonado.com/pricing?campaign=launch&checkout=start&tier=team&interval=annual#plans'
			)
		).toBe('/pricing?campaign=launch#plans');
	});

	test('redirects to hosted checkout with the exact operation guard', async () => {
		const guard = createBillingOperations().begin('user-a');
		const events: CheckoutProgress[] = [];
		await runCheckout('team', 'monthly', { guard, emit: (event) => events.push(event) });

		expect(create).toHaveBeenCalledWith('team', 'monthly', 'user-a', guard.isCurrent);
		expect(redirects).toEqual([checkout.checkoutUrl]);
		expect(events.map((event) => event.status)).toEqual(['starting', 'starting', 'redirecting']);
		expect(events.at(-1)).toMatchObject({
			status: 'redirecting',
			tierId: 'team',
			interval: 'monthly',
			attemptId: checkout.attemptId
		});
	});

	test('saves the choice and starts sign-in for a signed-out user', async () => {
		initializeBehavior = async () => ({ ...client, auth: { getUser: () => null } });
		const events: CheckoutProgress[] = [];
		await runCheckout('team', 'annual', {
			guard: createBillingOperations().begin('signed-out'),
			emit: (event) => events.push(event)
		});

		expect(signIn).toHaveBeenCalledTimes(1);
		expect(create).toHaveBeenCalledTimes(0);
		expect(redirects).toEqual([]);
		expect(events.map((event) => event.status)).toEqual(['starting', 'signing_in']);
		expect(readPendingPricingAction()).toEqual({
			type: 'checkout',
			tierId: 'team',
			interval: 'annual'
		});
	});

	test('keeps the selection and reports a lost session on callback resumption', async () => {
		initializeBehavior = async () => ({ ...client, auth: { getUser: () => null } });
		const events: CheckoutProgress[] = [];
		await runCheckout('team', 'annual', {
			guard: createBillingOperations().begin('signed-out'),
			allowSignIn: false,
			emit: (event) => events.push(event)
		});

		expect(events.at(-1)).toMatchObject({
			status: 'error',
			message: expect.stringContaining('Your sign-in session could not be restored.')
		});
		expect(readPendingPricingAction()).toEqual({
			type: 'checkout',
			tierId: 'team',
			interval: 'annual'
		});
		expect(signIn).toHaveBeenCalledTimes(0);
		expect(create).toHaveBeenCalledTimes(0);
	});

	test.each(['initialization', 'creation', 'sign-in'])(
		'%s failures reach the owning callback',
		async (stage) => {
			const fail = async () => {
				throw new Error(`${stage} unavailable`);
			};
			if (stage === 'initialization') initializeBehavior = fail;
			if (stage === 'creation') createBehavior = fail;
			if (stage === 'sign-in') {
				initializeBehavior = async () => ({ ...client, auth: { getUser: () => null } });
				signInBehavior = fail;
			}
			const events: CheckoutProgress[] = [];
			await runCheckout('team', 'monthly', {
				guard: createBillingOperations().begin('user-a'),
				emit: (event) => events.push(event)
			});
			expect(events.at(-1)).toMatchObject({ status: 'error', message: `${stage} unavailable` });
			expect(redirects).toEqual([]);
		}
	);

	test('a required storage write failure reports how to fix storage before billing starts', async () => {
		Object.defineProperty(globalThis, 'sessionStorage', {
			value: {
				...storage,
				setItem: () => {
					throw new DOMException('Quota exceeded', 'QuotaExceededError');
				}
			},
			configurable: true
		});
		const events: CheckoutProgress[] = [];
		await runCheckout('team', 'monthly', {
			guard: createBillingOperations().begin('user-a'),
			emit: (event) => events.push(event)
		});
		expect(events.map((event) => [event.status, event.message])).toEqual([
			['error', 'Browser storage is unavailable. Enable site storage before starting checkout.']
		]);
		expect(initialize).toHaveBeenCalledTimes(0);
		expect(create).toHaveBeenCalledTimes(0);
	});

	test('cancellation while initializing prevents checkout creation', async () => {
		const pending = deferred<typeof client>();
		const started = deferred<void>();
		initializeBehavior = () => {
			started.resolve();
			return pending.promise;
		};
		const operations = createBillingOperations();
		const events: CheckoutProgress[] = [];
		const run = runCheckout('team', 'monthly', {
			guard: operations.begin('user-a'),
			emit: (event) => events.push(event)
		});
		await started.promise;
		operations.bumpGeneration();
		pending.resolve(client);
		await run;
		expect(create).toHaveBeenCalledTimes(0);
		expect(redirects).toEqual([]);
		expect(events.map((event) => event.status)).toEqual(['starting']);
	});

	test('out-of-order same-account creation results redirect only the current checkout', async () => {
		const oldResult = deferred<Checkout>();
		const started = deferred<void>();
		createBehavior = () => {
			started.resolve();
			return oldResult.promise;
		};
		const operations = createBillingOperations();
		const oldEvents: CheckoutProgress[] = [];
		const oldRun = runCheckout('team', 'monthly', {
			guard: operations.begin('user-a'),
			emit: (event) => oldEvents.push(event)
		});
		await started.promise;
		const currentCheckout = {
			checkoutUrl: 'https://checkout.example/current',
			attemptId: 'current'
		};
		createBehavior = async () => currentCheckout;
		const currentEvents: CheckoutProgress[] = [];
		await runCheckout('team', 'annual', {
			guard: operations.begin('user-a'),
			emit: (event) => currentEvents.push(event)
		});
		oldResult.resolve(checkout);
		await oldRun;

		expect(redirects).toEqual([currentCheckout.checkoutUrl]);
		expect(oldEvents.map((event) => event.status)).toEqual(['starting', 'starting']);
		expect(currentEvents.at(-1)).toMatchObject({ status: 'redirecting', attemptId: 'current' });
	});

	test('a changed live account reports cancellation before checkout creation', async () => {
		initializeBehavior = async () => ({
			...client,
			auth: { getUser: () => ({ id: 'user-b', email: 'b@example.com' }) }
		});
		const events: CheckoutProgress[] = [];
		await runCheckout('team', 'monthly', {
			guard: createBillingOperations().begin('user-a'),
			emit: (event) => events.push(event)
		});
		expect(create).toHaveBeenCalledTimes(0);
		expect(events.at(-1)).toMatchObject({
			status: 'error',
			message: 'This billing action was cancelled.'
		});
	});
});
