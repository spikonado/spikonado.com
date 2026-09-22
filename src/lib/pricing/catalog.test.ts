import { describe, expect, test } from 'bun:test';
import type { DodoPublicPrice, PublicPricingCatalog } from '@/lib/convex/api';
import {
	buildPricingPlans,
	isBillingInterval,
	monthlyEquivalentMajor,
	priceLabel
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
			features: ['Community support'],
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
			features: ['Shared projects'],
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
			cardPrice: '$20/mo.',
			perMonthLabel: '$20',
			billed: 'Billed monthly',
			currency: 'USD',
			periodMajor: 20,
			periodLabel: '$20',
			compareAt: null
		});
		expect(priceLabel('annual', prices)).toEqual({
			cardPrice: '$216/yr.',
			perMonthLabel: '$18',
			billed: 'Billed annually',
			currency: 'USD',
			periodMajor: 216,
			periodLabel: '$216',
			compareAt: '$240'
		});
		expect(priceLabel('monthly', { monthly: null, annual: null })).toBeNull();
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
			'$5 of AI usage each week',
			'$15 of AI usage each month',
			'Community support'
		]);
		expect(plans[1]).toMatchObject({
			name: 'Team',
			description: 'For engineering teams.',
			highlighted: true,
			features: ['$25 of AI usage each week', '$75 of AI usage each month', 'Shared projects']
		});
	});

	test('validates billing intervals', () => {
		expect(isBillingInterval('monthly')).toBe(true);
		expect(isBillingInterval('annual')).toBe(true);
		expect(isBillingInterval('weekly')).toBe(false);
		expect(isBillingInterval(null)).toBe(false);
	});
});
