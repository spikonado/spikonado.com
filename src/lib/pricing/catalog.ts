import type { DodoPublicPrice, PublicPricingCatalog, PublicPricingPlan } from '@/lib/convex/api';

/** Marketing catalog for Sprocket plans. Entitlement copy is built from live Convex data. */

export const billingIntervalIds = ['monthly', 'annual'] as const;
export type BillingInterval = (typeof billingIntervalIds)[number];

export type PricingPlan = {
	id: string;
	name: string;
	description: string;
	highlighted?: boolean;
	features: string[];
};

export type PricingFaq = {
	question: string;
	answer: string;
};

export type PriceDisplay = {
	/** Compact card price like "$20/mo." or "$216/yr." */
	cardPrice: string;
	perMonthLabel: string;
	billed: string;
	currency: string;
	/** Major units for the full billing period (e.g. 20 monthly, 216 annual). */
	periodMajor: number;
	/** Formatted full-period amount, e.g. "$216". */
	periodLabel: string;
	/** Monthly × 12, struck through on the yearly card when it is higher than annual. */
	compareAt: string | null;
};

function usageFeature(amount: number): string {
	return `${formatMoney(amount, 'USD')} of AI usage each month`;
}

function weeklyUsageFeature(amount: number): string {
	return `${formatMoney(amount, 'USD')} of AI usage each week`;
}

function majorFromMinor(amountMinor: number): number {
	return amountMinor / 100;
}

function formatMoney(amountMajor: number, currency: string): string {
	try {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency,
			maximumFractionDigits: Number.isInteger(amountMajor) ? 0 : 2
		}).format(amountMajor);
	} catch {
		return `$${amountMajor}`;
	}
}

/** Normalize a Dodo recurring price into a monthly-equivalent major-unit amount. */
export function monthlyEquivalentMajor(price: DodoPublicPrice): number {
	const total = majorFromMinor(price.amountMinor);
	const count = Math.max(1, price.paymentFrequencyCount);
	switch (price.paymentFrequencyInterval) {
		case 'Year':
			return total / (12 * count);
		case 'Month':
			return total / count;
		case 'Week':
			return (total * (52 / 12)) / count;
		case 'Day':
			return (total * (365 / 12)) / count;
		default:
			return total;
	}
}

type TierPrices = PublicPricingPlan['prices'];

export function pricesForPlan(plan: PublicPricingPlan, catalog: PublicPricingCatalog): TierPrices {
	if (plan.prices) return plan.prices;
	if (plan.id === 'pro' && catalog.proPrices) return catalog.proPrices;
	return { monthly: null, annual: null };
}

export function priceLabel(interval: BillingInterval, prices: TierPrices): PriceDisplay | null {
	const price = prices[interval];
	if (!price) return null;
	const perMonth = monthlyEquivalentMajor(price);
	const periodMajor = majorFromMinor(price.amountMinor);
	const money = formatMoney(perMonth, price.currency);
	const periodLabel = formatMoney(periodMajor, price.currency);
	if (interval === 'annual') {
		const monthlyTimes12 = prices.monthly ? monthlyEquivalentMajor(prices.monthly) * 12 : null;
		const compareAt =
			monthlyTimes12 !== null && monthlyTimes12 > periodMajor
				? formatMoney(monthlyTimes12, price.currency)
				: null;
		return {
			cardPrice: `${periodLabel}/yr.`,
			perMonthLabel: money,
			billed: 'Billed annually',
			currency: price.currency,
			periodMajor,
			periodLabel,
			compareAt
		};
	}
	return {
		cardPrice: `${money}/mo.`,
		perMonthLabel: money,
		billed: 'Billed monthly',
		currency: price.currency,
		periodMajor,
		periodLabel,
		compareAt: null
	};
}

export function buildPricingPlans(catalog: PublicPricingCatalog): PricingPlan[] {
	return catalog.plans.map((plan) => {
		const weeklyUsage =
			typeof plan.weeklyUsageDollars === 'number' ? plan.weeklyUsageDollars : null;
		const configuredFeatures = Array.isArray(plan.features)
			? plan.features.map((feature) => feature.trim()).filter(Boolean)
			: [];
		const configuredDescription = plan.description?.trim();
		const features = [
			...(plan.id === 'free' ? ['No credit card required'] : []),
			...(weeklyUsage === null ? [] : [weeklyUsageFeature(weeklyUsage)]),
			usageFeature(plan.monthlyUsageDollars),
			...configuredFeatures
		];
		return {
			id: plan.id,
			name: plan.label,
			description:
				configuredDescription ||
				(plan.id === 'free'
					? 'For trying Sprocket and building without a card.'
					: `For projects that need the ${plan.label} usage limits.`),
			highlighted: plan.highlighted ?? false,
			features: [...new Set(features)]
		};
	});
}

export const pricingFaqs: PricingFaq[] = [
	{
		question: 'Can I use Sprocket for free?',
		answer:
			'Yes. The Free plan includes selected models and a monthly AI usage quota. Every feature is included at no extra cost, and everything except AI usage is unlimited. Sign in to start—no card required.'
	},
	{
		question: 'What happens when I use up my AI credits?',
		answer:
			'Metered models pause until your usage window resets. Unlimited models stay available. The run that hits the limit stops, and the model picker switches to models available on your plan.'
	}
];

export function isBillingInterval(value: string | null | undefined): value is BillingInterval {
	return value === 'monthly' || value === 'annual';
}
