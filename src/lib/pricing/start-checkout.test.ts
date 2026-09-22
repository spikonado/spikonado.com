import { describe, expect, test } from 'bun:test';
import { checkoutRequestFromSearch, pricingUrlWithoutCheckoutCommand } from './start-checkout.ts';

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

	test('defaults legacy or invalid requests to Pro monthly', () => {
		expect(checkoutRequestFromSearch('?checkout=start')).toEqual({
			tierId: 'pro',
			interval: 'monthly'
		});
		expect(checkoutRequestFromSearch('?checkout=start&tier=&interval=weekly')).toEqual({
			tierId: 'pro',
			interval: 'monthly'
		});
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
