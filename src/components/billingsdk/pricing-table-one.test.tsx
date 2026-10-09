import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BillingPlan } from '@/lib/billingsdk-config';
import { PricingTableOne, type PricingTableOneProps } from './pricing-table-one.tsx';

const basePlan: BillingPlan = {
	id: 'team',
	title: 'Team',
	description: 'For engineering teams.',
	monthlyPrice: 20,
	monthlyCurrency: 'USD',
	yearlyPrice: 216,
	yearlyCurrency: 'USD',
	buttonText: 'Get Team',
	features: [{ name: 'Shared projects' }]
};

function render(
	plan: BillingPlan,
	interval: 'monthly' | 'annual' = 'annual',
	props: Partial<PricingTableOneProps> = {}
): string {
	return renderToStaticMarkup(
		createElement(PricingTableOne, {
			plans: [plan],
			interval,
			onIntervalChange: () => {},
			onPlanSelect: () => {},
			...props
		})
	);
}

describe('pricing table card rendering', () => {
	test('places features directly after the price when the description is empty', () => {
		const document = new DOMParser().parseFromString(
			render({ ...basePlan, description: '' }),
			'text/html'
		);
		expect(
			Array.from(document.querySelector('article')!.children, (child) => child.tagName)
		).toEqual(['H2', 'DIV', 'UL', 'BUTTON']);
	});

	test('renders a configured description between the price and features', () => {
		const document = new DOMParser().parseFromString(render(basePlan), 'text/html');
		expect(document.querySelector('article > p')?.textContent).toBe('For engineering teams.');
	});

	test.each([
		['monthly', 'CA$20', 'per month'],
		['annual', 'A$216', 'per year']
	] as const)('renders the %s price in its own currency', (interval, price, period) => {
		const markup = render({ ...basePlan, monthlyCurrency: 'CAD', yearlyCurrency: 'AUD' }, interval);
		expect(markup).toContain(price);
		expect(markup).toContain(period);
	});

	test('preserves fractional price precision', () => {
		const markup = render({ ...basePlan, monthlyPrice: 19.5 }, 'monthly');
		expect(markup).toContain('$19.50');
	});

	test('renders a zero price as available', () => {
		const markup = render({ ...basePlan, monthlyPrice: 0 }, 'monthly');
		expect(markup).toContain('$0');
		expect(markup).toContain('per month');
	});

	test.each(['monthly', 'annual'] as const)('renders an unavailable %s price', (interval) => {
		const plan = {
			...basePlan,
			...(interval === 'monthly' ? { monthlyPrice: null } : { yearlyPrice: null })
		};
		const markup = render(plan, interval);
		expect(markup).toContain('Unavailable');
		expect(markup).not.toContain('per month');
		expect(markup).not.toContain('per year');
	});

	test('shows each annual discount and the largest potential saving', () => {
		const markup = render(basePlan, 'annual', {
			plans: [basePlan, { ...basePlan, id: 'pro', title: 'Pro', yearlyPrice: 192 }]
		});
		const document = new DOMParser().parseFromString(markup, 'text/html');
		expect(document.querySelector('fieldset')?.textContent).toContain('Save up to 20%');
		expect(
			Array.from(document.querySelectorAll('article > div'), (card) => card.textContent)
		).toEqual(['$216per year, 10% off', '$192per year, 20% off']);
	});

	test.each([
		{ monthlyCurrency: 'EUR' },
		{ monthlyPrice: null },
		{ yearlyPrice: null },
		{ monthlyPrice: 0 },
		{ yearlyPrice: 240 },
		{ yearlyPrice: 300 }
	])('omits discounts without a lower comparable annual price: %p', (prices) => {
		const markup = render({ ...basePlan, ...prices });
		expect(markup).not.toContain('Save');
		expect(markup).not.toContain('% off');
	});

	test('uses the actual action text as the button label', () => {
		const document = new DOMParser().parseFromString(
			render(basePlan, 'monthly', { buttonLabel: () => 'Manage billing' }),
			'text/html'
		);
		const button = document.querySelector('article button')!;
		expect(button.textContent).toBe('Manage billing');
		expect(button.getAttribute('aria-label')).toBeNull();
	});
});
