import { describe, expect, test } from 'bun:test';
import { buildPlanCards, formatPrice } from './catalog';

describe('formatPrice', () => {
	test('uses each currency’s minor units', () => {
		expect(formatPrice({ amountMinor: 2000, currency: 'USD' })).toBe('$20');
		expect(formatPrice({ amountMinor: 1999, currency: 'USD' })).toBe('$19.99');
		expect(formatPrice({ amountMinor: 3000, currency: 'JPY' })).toBe('¥3,000');
		expect(formatPrice({ amountMinor: 12_345, currency: 'KWD' })).toMatch(/^KWD\s12\.345$/);
	});
});

test('buildPlanCards prices plans and computes the annual discount', () => {
	const [free, pro] = buildPlanCards({
		plans: [
			{
				id: 'free',
				label: 'Free',
				monthlyUsageDollars: 5,
				description: null,
				features: [],
				highlighted: false,
				prices: { monthly: null, annual: null }
			},
			{
				id: 'pro',
				label: 'Pro',
				monthlyUsageDollars: 50,
				description: ' For daily work ',
				features: ['Frontier models', ' '],
				highlighted: true,
				prices: {
					monthly: { amountMinor: 2000, currency: 'USD' },
					annual: { amountMinor: 20_000, currency: 'USD' }
				}
			}
		]
	});
	expect(free.prices).toEqual({ monthly: '$0', annual: '$0' });
	expect(free.features).toEqual(['No credit card required', '$5 of AI usage each month']);
	expect(pro).toMatchObject({
		description: 'For daily work',
		features: ['$50 of AI usage each month', 'Frontier models'],
		prices: { monthly: '$20', annual: '$200' },
		annualDiscountPercent: 17
	});
});
