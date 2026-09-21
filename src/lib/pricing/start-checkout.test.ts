import { describe, expect, test } from 'bun:test';
import { checkoutIntervalFromSearch, pricingUrlWithoutCheckoutCommand } from './start-checkout.ts';

describe('checkoutIntervalFromSearch', () => {
	test('reads monthly and annual Get Pro deep links', () => {
		expect(checkoutIntervalFromSearch('?checkout=start&interval=monthly')).toBe('monthly');
		expect(checkoutIntervalFromSearch('?checkout=start&interval=annual')).toBe('annual');
		expect(checkoutIntervalFromSearch('checkout=start&interval=annual')).toBe('annual');
	});

	test('defaults invalid intervals to monthly and ignores other checkout params', () => {
		expect(checkoutIntervalFromSearch('?checkout=start')).toBe('monthly');
		expect(checkoutIntervalFromSearch('?checkout=start&interval=weekly')).toBe('monthly');
		expect(checkoutIntervalFromSearch('?checkout=return')).toBeNull();
		expect(checkoutIntervalFromSearch('')).toBeNull();
	});
});

describe('pricingUrlWithoutCheckoutCommand', () => {
	test('consumes checkout parameters without removing unrelated state', () => {
		expect(
			pricingUrlWithoutCheckoutCommand(
				'https://spikonado.com/pricing?campaign=launch&checkout=start&interval=annual#plans'
			)
		).toBe('/pricing?campaign=launch#plans');
	});
});
