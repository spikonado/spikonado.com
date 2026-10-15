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
	expect(free.features.map(({ label }) => label)).toEqual([
		'$5 of AI usage each month',
		'Bring your own API keys and subscriptions',
		'Unlimited context from the web',
		'Fair source',
		'Self-host anytime'
	]);
	expect(pro).toMatchObject({
		description: 'For daily work',
		prices: { monthly: '$20', annual: '$200' },
		annualPerMonth: '$16.67',
		annualDiscountPercent: 17
	});
	expect(pro.features.at(-1)).toEqual({ label: 'Frontier models' });
});
