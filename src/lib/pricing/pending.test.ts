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

	test('stores and reads checkout interval', () => {
		storePendingPricingAction({ type: 'checkout', interval: 'annual' });
		expect(readPendingPricingAction()).toEqual({ type: 'checkout', interval: 'annual' });
	});

	test('clears legacy free-start pending actions and corrupt payloads', () => {
		sessionStorage.setItem('spikonado_pricing_pending', '{"type":"start_free"}');
		expect(readPendingPricingAction()).toBeNull();
		expect(sessionStorage.getItem('spikonado_pricing_pending')).toBeNull();

		sessionStorage.setItem('spikonado_pricing_pending', '{"type":"checkout","interval":"weekly"}');
		expect(readPendingPricingAction()).toBeNull();
		expect(sessionStorage.getItem('spikonado_pricing_pending')).toBeNull();
	});
});
