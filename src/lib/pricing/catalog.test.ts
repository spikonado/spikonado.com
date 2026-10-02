import { describe, expect, test } from 'bun:test';
import type { DodoPublicPrice, PublicPricingCatalog } from '@/lib/convex/api';
import {
	buildPricingPlans,
	currencyCodeLabel,
	currencyMinorExponent,
	isBillingInterval,
	majorFromMinor,
	monthlyEquivalentMajor,
	priceLabel
} from './catalog.ts';

function price(overrides: Partial<DodoPublicPrice>): DodoPublicPrice {
	return {
		productId: 'prod_x',
		name: null,
		amountMinor: 1_000,
		currency: 'USD',
		paymentFrequencyCount: 1,
		paymentFrequencyInterval: 'Month',
		...overrides
	};
}

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
	test('derives display amounts from each tier Dodo price', () => {
		const prices = sampleCatalog.plans[1]!.prices;
		expect(monthlyEquivalentMajor(monthlyPrice)).toBe(20);
		expect(monthlyEquivalentMajor(annualPrice)).toBe(18);
		expect(priceLabel('monthly', prices)).toEqual({
			cardPrice: '$20.00/mo.',
			perMonthLabel: '$20.00',
			billed: 'Billed monthly',
			currency: 'USD',
			periodMajor: 20,
			periodLabel: '$20.00',
			compareAt: null
		});
		expect(priceLabel('annual', prices)).toEqual({
			cardPrice: '$216.00/yr.',
			perMonthLabel: '$18.00',
			billed: 'Billed annually',
			currency: 'USD',
			periodMajor: 216,
			periodLabel: '$216.00',
			compareAt: '$240.00'
		});
		expect(priceLabel('monthly', { monthly: null, annual: null })).toBeNull();
	});

	test('omits the annual compare-at price when interval currencies differ', () => {
		const prices = {
			monthly: { ...monthlyPrice, currency: 'EUR' },
			annual: annualPrice
		};
		expect(priceLabel('annual', prices)?.compareAt).toBeNull();
		expect(priceLabel('annual', prices)?.cardPrice).toBe('$216.00/yr.');
	});

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

		test('formats zero-decimal currencies without fractional digits', () => {
			const jpy = price({ amountMinor: 2_000, currency: 'JPY' });
			expect(monthlyEquivalentMajor(jpy)).toBe(2_000);
			const label = priceLabel('monthly', { monthly: jpy, annual: null });
			expect(label?.periodMajor).toBe(2_000);
			expect(label?.periodLabel).toContain('2,000');
			expect(label?.periodLabel).not.toContain('.');
		});

		test('formats three-decimal currencies with three fractional digits', () => {
			const kwd = price({ amountMinor: 2_000, currency: 'KWD' });
			const label = priceLabel('monthly', { monthly: kwd, annual: null });
			expect(label?.periodMajor).toBe(2);
			expect(label?.periodLabel).toContain('2.000');
			expect(label?.cardPrice).toContain('/mo.');
			// A non-integer three-decimal amount keeps all three fractional digits.
			const kwdFraction = price({ amountMinor: 2_500, currency: 'KWD' });
			expect(priceLabel('monthly', { monthly: kwdFraction, annual: null })?.periodLabel).toContain(
				'2.500'
			);
		});

		test('disambiguates dollar currencies that share a symbol', () => {
			expect(currencyCodeLabel('USD')).toBe('$ USD');
			expect(currencyCodeLabel('CAD')).toBe('$ CAD');
			expect(currencyCodeLabel('AUD')).toBe('$ AUD');
			expect(currencyCodeLabel('EUR')).toBe('€');
			expect(currencyCodeLabel('JPY')).toBe('¥');
			expect(() => currencyCodeLabel('NOT_A_CURRENCY')).toThrow(/Unsupported currency/);
		});
	});

	test('builds every plan from live card and allowance data', () => {
		const plans = buildPricingPlans(sampleCatalog);
		expect(plans.map((plan) => plan.id)).toEqual(['free', 'team']);
		expect(plans[0]).toMatchObject({
			name: 'Free',
			description: 'For trying Sprocket and building without a card.',
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

	test('validates billing intervals', () => {
		expect(isBillingInterval('monthly')).toBe(true);
		expect(isBillingInterval('annual')).toBe(true);
		expect(isBillingInterval('weekly')).toBe(false);
		expect(isBillingInterval(null)).toBe(false);
	});
});
