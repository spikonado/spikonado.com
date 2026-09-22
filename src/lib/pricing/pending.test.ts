import { beforeEach, describe, expect, test } from 'bun:test';
import {
	clearPendingPricingAction,
	readPendingPricingAction,
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
});
