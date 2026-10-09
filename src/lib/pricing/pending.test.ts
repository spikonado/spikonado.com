import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

function restoreStorage(): void {
	Object.defineProperty(globalThis, 'sessionStorage', {
		value: sessionStorageMock,
		configurable: true
	});
}

restoreStorage();

afterEach(restoreStorage);

describe('pending pricing actions', () => {
	beforeEach(() => {
		restoreStorage();
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

	test.each(['missing', 'blocked getter', 'throwing operations'])(
		'reads and cleanup tolerate %s storage while required writes report the problem',
		(failure) => {
			const blocked = () => {
				throw new DOMException('Storage blocked', 'SecurityError');
			};
			Object.defineProperty(
				globalThis,
				'sessionStorage',
				failure === 'blocked getter'
					? { get: blocked, configurable: true }
					: {
							value:
								failure === 'missing'
									? undefined
									: { getItem: blocked, setItem: blocked, removeItem: blocked },
							configurable: true
						}
			);

			expect(readPendingPricingAction()).toBeNull();
			expect(readCheckoutAttempt('user-a')).toBeNull();
			clearPendingPricingAction();
			clearCheckoutAttempt();
			expect(() =>
				storePendingPricingAction({ type: 'checkout', tierId: 'team', interval: 'annual' })
			).toThrow('Browser storage is unavailable. Enable site storage before starting checkout.');
			expect(() =>
				storeCheckoutAttempt('user-a', {
					attemptId: 'attempt-1',
					tierId: 'team',
					interval: 'annual'
				})
			).toThrow('Browser storage is unavailable. Enable site storage before starting checkout.');
		}
	);

	test('reads discard corrupt state even when cleanup is blocked', () => {
		Object.defineProperty(globalThis, 'sessionStorage', {
			value: {
				getItem: () => '{not json',
				removeItem: () => {
					throw new DOMException('Storage blocked', 'SecurityError');
				}
			},
			configurable: true
		});
		expect(readPendingPricingAction()).toBeNull();
		expect(readCheckoutAttempt('user-a')).toBeNull();
	});

	describe('checkout attempt references', () => {
		const attempt = {
			attemptId: 'attempt-1',
			tierId: 'team',
			interval: 'monthly' as const
		};

		test('reads back an attempt for the account that started it', () => {
			storeCheckoutAttempt('user-a', attempt);
			expect(readCheckoutAttempt('user-a')).toEqual(attempt);
		});

		test('reads previous attempts without depending on their extra timestamp', () => {
			sessionStorage.setItem(
				'spikonado_pricing_attempt',
				JSON.stringify({ userId: 'user-a', ...attempt, startedAt: 1_700_000_000_000 })
			);
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
				'{"userId":"user-a","attemptId":"x","tierId":"team","interval":"weekly"}'
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
