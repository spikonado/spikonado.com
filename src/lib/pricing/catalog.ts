import type { BillingInterval, DodoPrice, PublicPricingCatalog } from '@/lib/convex/api';

export type PlanCard = {
	id: string;
	name: string;
	description: string;
	highlighted: boolean;
	features: string[];
	isFree: boolean;
	prices: Record<BillingInterval, string | null>;
	annualPerMonth: string | null;
	annualDiscountPercent: number;
};

export const pricingFaqs = [
	{
		question: 'What are my payment options?',
		answer:
			'Credit and debit cards, UPI, Apple Pay, Google Pay, Cash App Pay, Klarna, RuPay, Satispay, Kakao Pay, Naver Pay, and Pix. Checkout shows the options available in your country and currency.'
	}
];

export function isBillingInterval(value: unknown): value is BillingInterval {
	return value === 'monthly' || value === 'annual';
}

// Dodo amounts are in ISO 4217 minor units, which Intl's currency fraction digits match.
export function formatPrice({ amountMinor, currency }: DodoPrice): string {
	const digits =
		new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
			.maximumFractionDigits ?? 2;
	const amount = amountMinor / 10 ** digits;
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		minimumFractionDigits: Number.isInteger(amount) ? 0 : digits,
		maximumFractionDigits: digits
	}).format(amount);
}

function annualDiscountPercent(monthly: DodoPrice | null, annual: DodoPrice | null): number {
	if (!monthly || !annual || monthly.currency !== annual.currency || monthly.amountMinor <= 0)
		return 0;
	const yearOfMonthly = monthly.amountMinor * 12;
	return Math.max(0, Math.round(((yearOfMonthly - annual.amountMinor) / yearOfMonthly) * 100));
}

export function buildPlanCards(catalog: PublicPricingCatalog): PlanCard[] {
	return catalog.plans.map((plan) => {
		const isFree = plan.id === 'free';
		const { monthly, annual } = plan.prices;
		const free = formatPrice({ amountMinor: 0, currency: 'USD' });
		return {
			id: plan.id,
			name: plan.label,
			description: plan.description?.trim() ?? '',
			highlighted: plan.highlighted,
			isFree,
			features: [
				...new Set([
					...(isFree ? ['No credit card required'] : []),
					`${formatPrice({ amountMinor: Math.round(plan.monthlyUsageDollars * 100), currency: 'USD' })} of AI usage each month`,
					...plan.features.map((feature) => feature.trim()).filter(Boolean)
				])
			],
			prices: {
				monthly: isFree ? free : monthly && formatPrice(monthly),
				annual: isFree ? free : annual && formatPrice(annual)
			},
			annualPerMonth: isFree
				? free
				: annual &&
					formatPrice({
						amountMinor: Math.round(annual.amountMinor / 12),
						currency: annual.currency
					}),
			annualDiscountPercent: annualDiscountPercent(monthly, annual)
		};
	});
}
