import { describe, expect, test } from 'bun:test';
import type { PublicPricingCatalog } from '@/lib/convex/api';
import {
	buildPricingPlans,
	isBillingInterval,
	monthlyEquivalentMajor,
	proPriceLabel
} from './catalog.ts';

const sampleCatalog: PublicPricingCatalog = {
	plans: [
		{
			id: 'free',
			label: 'Free',
			monthlyUsageDollars: 15
		},
		{
			id: 'pro',
			label: 'Pro',
			monthlyUsageDollars: 75
		}
	],
	proPrices: {
		monthly: {
			productId: 'prod_monthly',
			name: 'Pro Monthly',
			amountMinor: 2_000,
			currency: 'USD',
			paymentFrequencyCount: 1,
			paymentFrequencyInterval: 'Month'
		},
		annual: {
			productId: 'prod_annual',
			name: 'Pro Annual',
			amountMinor: 21_600,
			currency: 'USD',
			paymentFrequencyCount: 1,
			paymentFrequencyInterval: 'Year'
		}
	}
};

describe('pricing catalog', () => {
	test('derives Pro display amounts from Dodo product prices', () => {
		expect(monthlyEquivalentMajor(sampleCatalog.proPrices!.monthly)).toBe(20);
		expect(monthlyEquivalentMajor(sampleCatalog.proPrices!.annual)).toBe(18);
		expect(proPriceLabel('monthly', sampleCatalog.proPrices)).toEqual({
			cardPrice: '$20/mo.',
			perMonthLabel: '$20',
			billed: 'Billed monthly',
			currency: 'USD',
			periodMajor: 20,
			periodLabel: '$20',
			compareAt: null
		});
		expect(proPriceLabel('annual', sampleCatalog.proPrices)).toEqual({
			cardPrice: '$216/yr.',
			perMonthLabel: '$18',
			billed: 'Billed annually',
			currency: 'USD',
			periodMajor: 216,
			periodLabel: '$216',
			compareAt: '$240'
		});
		expect(proPriceLabel('monthly', null)).toBeNull();
	});

	test('builds cumulative free/pro/enterprise plans from live catalog data', () => {
		const plans = buildPricingPlans(sampleCatalog);
		expect(plans.map((plan) => plan.id)).toEqual(['free', 'pro', 'enterprise']);
		expect(plans[0]?.includesLabel).toBe('Includes:');
		expect(plans[1]?.includesLabel).toBe('Everything in Free, plus:');
		expect(plans[2]?.includesLabel).toBe('Everything in Pro, plus:');
		expect(plans.find((plan) => plan.id === 'pro')?.highlighted).toBe(true);
		expect(plans[0]?.features).toEqual([
			'No credit card required',
			'$15 of AI usage each month',
			'No extra charge for any feature',
			'Unlimited use of everything except AI',
			'Access to selected models'
		]);
		expect(plans[1]?.features).toEqual([
			'$75 of AI usage each month',
			'Access to our complete AI model catalog',
			'Access AI models at faster service tiers'
		]);
	});

	test('validates billing intervals', () => {
		expect(isBillingInterval('monthly')).toBe(true);
		expect(isBillingInterval('annual')).toBe(true);
		expect(isBillingInterval('weekly')).toBe(false);
		expect(isBillingInterval(null)).toBe(false);
	});
});
