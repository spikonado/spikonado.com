import { describe, expect, test } from 'bun:test';
import type { DodoPublicPrice, PublicPricingCatalog } from '@/lib/convex/api';
import {
	buildPricingPlans,
	currencyMinorExponent,
	formatPrice,
	isBillingInterval,
	majorFromMinor
} from './catalog.ts';

const monthlyPrice: DodoPublicPrice = {
	productId: 'prod_team_monthly',
	name: 'Team Monthly',
	amountMinor: 2_000,
	currency: 'USD',
	paymentFrequencyCount: 1,
	paymentFrequencyInterval: 'Month'
};

const annualPrice: DodoPublicPrice = {
	productId: 'prod_team_annual',
	name: 'Team Annual',
	amountMinor: 21_600,
	currency: 'USD',
	paymentFrequencyCount: 1,
	paymentFrequencyInterval: 'Year'
};

const sampleCatalog: PublicPricingCatalog = {
	plans: [
		{
			id: 'free',
			label: 'Free',
			weeklyUsageDollars: 5,
			monthlyUsageDollars: 15,
			description: null,
			features: ['Selected AI models', 'Community support'],
			displayOrder: 0,
			highlighted: false,
			prices: { monthly: null, annual: null }
		},
		{
			id: 'team',
			label: 'Team',
			weeklyUsageDollars: 25,
			monthlyUsageDollars: 75,
			description: 'For engineering teams.',
			features: ['All available AI models', 'Shared projects'],
			displayOrder: 10,
			highlighted: true,
			prices: { monthly: monthlyPrice, annual: annualPrice }
		}
	]
};

describe('pricing catalog', () => {
	describe('currency exponents', () => {
		test('resolves zero-, two-, and three-decimal ISO exponents', () => {
			expect(currencyMinorExponent('USD')).toBe(2);
			expect(currencyMinorExponent('JPY')).toBe(0);
			expect(currencyMinorExponent('KWD')).toBe(3);
			expect(currencyMinorExponent('usd')).toBe(2);
		});

		test('fails explicitly on unsupported or unknown currencies instead of guessing /100', () => {
			expect(() => currencyMinorExponent('NOT_A_CURRENCY')).toThrow(/Unsupported currency/);
			expect(() => currencyMinorExponent('XXX')).toThrow(/Unsupported currency/);
			expect(() => currencyMinorExponent('')).toThrow(/Unsupported currency/);
			expect(() => majorFromMinor(1_000, 'NOT_A_CURRENCY')).toThrow(/Unsupported currency/);
		});

		test('converts minor units with the currency exponent', () => {
			expect(majorFromMinor(2_000, 'USD')).toBe(20);
			expect(majorFromMinor(2_000, 'JPY')).toBe(2_000);
			expect(majorFromMinor(2_000, 'KWD')).toBe(2);
		});
	});

	test.each([
		[0, 'USD', '$0'],
		[20, 'USD', '$20'],
		[20, 'CAD', 'CA$20'],
		[20, 'AUD', 'A$20'],
		[20, 'CNY', 'CN¥20'],
		[20, 'EUR', '€20'],
		[2_000, 'JPY', '¥2,000'],
		[19.5, 'USD', '$19.50'],
		[19.99, 'CAD', 'CA$19.99'],
		[2, 'KWD', 'KWD\u00a02'],
		[2.5, 'KWD', 'KWD\u00a02.500'],
		[2.001, 'KWD', 'KWD\u00a02.001'],
		[20, ' cad ', 'CA$20']
	])('formats %p %s as %s', (amount, currency, expected) => {
		expect(formatPrice(amount, currency)).toBe(expected);
	});

	test('rejects unsupported currencies when formatting', () => {
		expect(() => formatPrice(20, 'NOT_A_CURRENCY')).toThrow(/Unsupported currency/);
	});

	test('builds every plan from live card and allowance data', () => {
		const plans = buildPricingPlans(sampleCatalog);
		expect(plans.map((plan) => plan.id)).toEqual(['free', 'team']);
		expect(plans[0]).toMatchObject({
			name: 'Free',
			description: '',
			highlighted: false
		});
		expect(plans[0]?.features).toEqual([
			'No credit card required',
			'$15 of AI usage each month',
			'Selected AI models',
			'Community support'
		]);
		expect(plans[1]).toMatchObject({
			name: 'Team',
			description: 'For engineering teams.',
			highlighted: true,
			features: ['$75 of AI usage each month', 'All available AI models', 'Shared projects']
		});
	});

	test.each([
		[null, ''],
		['', ''],
		['   ', ''],
		['  For engineering teams.  ', 'For engineering teams.']
	])('uses only configured tier descriptions: %p', (description, expected) => {
		const plans = buildPricingPlans({
			plans: sampleCatalog.plans.map((plan) => ({ ...plan, description }))
		});
		expect(plans.map((plan) => plan.description)).toEqual([expected, expected]);
	});

	test('formats fractional monthly allowances and deduplicates configured features', () => {
		const plan = sampleCatalog.plans[0]!;
		const [result] = buildPricingPlans({
			plans: [
				{
					...plan,
					monthlyUsageDollars: 15.5,
					features: [' Selected AI models ', '', 'Selected AI models', 'No credit card required']
				}
			]
		});
		expect(result?.features).toEqual([
			'No credit card required',
			'$15.50 of AI usage each month',
			'Selected AI models'
		]);
	});

	test('validates billing intervals', () => {
		expect(isBillingInterval('monthly')).toBe(true);
		expect(isBillingInterval('annual')).toBe(true);
		expect(isBillingInterval('weekly')).toBe(false);
		expect(isBillingInterval(null)).toBe(false);
	});
});
