import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BillingPlan } from '@/lib/billingsdk-config';
import { PricingTableOne } from './pricing-table-one.tsx';

const basePlan: BillingPlan = {
	id: 'team',
	title: 'Team',
	description: 'For engineering teams.',
	currency: '$',
	monthlyPrice: '20',
	monthlyCurrency: 'USD',
	yearlyPrice: '216',
	yearlyCurrency: 'USD',
	buttonText: 'Get Team',
	features: [{ name: 'Shared projects', icon: 'check' }]
};

function render(plan: BillingPlan, interval: 'monthly' | 'annual' = 'annual'): string {
	return renderToStaticMarkup(
		createElement(PricingTableOne, {
			plans: [plan],
			interval,
			onIntervalChange: () => {},
			onPlanSelect: () => {}
		})
	);
}

describe('pricing table card rendering', () => {
	test('renders the yearly price with the selected interval currency', () => {
		const markup = render({ ...basePlan, currency: '€' }, 'annual');
		expect(markup).toContain('€216');
		expect(markup).toContain('per year');
		expect(markup).toContain('Save 10%');
	});

	test('omits discounts when interval prices use different currencies', () => {
		const markup = render({ ...basePlan, monthlyCurrency: 'EUR' });
		expect(markup).not.toContain('Save');
		expect(markup).not.toContain('% off');
	});
});
