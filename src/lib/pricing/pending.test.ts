import { beforeEach, describe, expect, test } from 'bun:test';
import {
	clearCheckoutAttempt,
	clearPendingPricingAction,
	readCheckoutAttempt,
	readPendingPricingAction,
	storeCheckoutAttempt,
	storePendingPricingAction
} from './pending.ts';

const memory = new Map<string, string>();

const sessionStorageMock = {
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => {
		memory.set(key, value);
	},
	removeItem: (key: string) => {
		memory.delete(key);
	}
};

Object.defineProperty(globalThis, 'sessionStorage', {
	value: sessionStorageMock,
	configurable: true
});

describe('pending pricing actions', () => {
	beforeEach(() => {
		memory.clear();
		clearPendingPricingAction();
	});

	test('stores and reads the checkout tier and interval', () => {
		storePendingPricingAction({ type: 'checkout', tierId: 'team', interval: 'annual' });
		expect(readPendingPricingAction()).toEqual({
			type: 'checkout',
			tierId: 'team',
			interval: 'annual'
		});
	});

	test('clears malformed checkout state', () => {
		sessionStorage.setItem('spikonado_pricing_pending', '{"type":"checkout","interval":"monthly"}');
		expect(readPendingPricingAction()).toBeNull();
		expect(sessionStorage.getItem('spikonado_pricing_pending')).toBeNull();

		sessionStorage.setItem('spikonado_pricing_pending', '{"type":"checkout","interval":"weekly"}');
		expect(readPendingPricingAction()).toBeNull();
		expect(sessionStorage.getItem('spikonado_pricing_pending')).toBeNull();

		sessionStorage.setItem('spikonado_pricing_pending', '{not json');
		expect(readPendingPricingAction()).toBeNull();
		expect(sessionStorage.getItem('spikonado_pricing_pending')).toBeNull();
	});

	describe('checkout attempt references', () => {
		const attempt = {
			attemptId: 'attempt-1',
			tierId: 'team',
			interval: 'monthly' as const,
			startedAt: 1_700_000_000_000
		};

		test('reads back an attempt for the account that started it', () => {
			storeCheckoutAttempt('user-a', attempt);
			expect(readCheckoutAttempt('user-a')).toEqual(attempt);
		});

		test('hides attempts from other accounts and signed-out readers', () => {
			storeCheckoutAttempt('user-a', attempt);
			expect(readCheckoutAttempt('user-b')).toBeNull();
			expect(readCheckoutAttempt(null)).toBeNull();
			expect(readCheckoutAttempt('')).toBeNull();
		});

		test('a new attempt replaces the previous one', () => {
			storeCheckoutAttempt('user-a', attempt);
			storeCheckoutAttempt('user-a', { ...attempt, attemptId: 'attempt-2' });
			expect(readCheckoutAttempt('user-a')?.attemptId).toBe('attempt-2');
		});

		test('drops malformed and cross-account forged entries', () => {
			storeCheckoutAttempt('user-a', attempt);
			sessionStorage.setItem(
				'spikonado_pricing_attempt',
				'{"userId":"user-a","attemptId":"x","tierId":"team","interval":"weekly","startedAt":1}'
			);
			expect(readCheckoutAttempt('user-a')).toBeNull();

			sessionStorage.setItem('spikonado_pricing_attempt', '{not json');
			expect(readCheckoutAttempt('user-a')).toBeNull();
			expect(sessionStorage.getItem('spikonado_pricing_attempt')).toBeNull();
		});

		test('clears the stored attempt on demand', () => {
			storeCheckoutAttempt('user-a', attempt);
			clearCheckoutAttempt();
			expect(readCheckoutAttempt('user-a')).toBeNull();
		});
	});
});
