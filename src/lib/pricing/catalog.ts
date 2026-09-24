import type { DodoPublicPrice, PublicPricingCatalog, PublicPricingPlan } from '@/lib/convex/api';
import { modelLabelsForTier, type PricingModelCatalog } from '@/lib/pricing/model-catalog';

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

function modelFeature(catalog: PricingModelCatalog, tierId: string): string | null {
	const labels = modelLabelsForTier(catalog, tierId);
	return labels.length > 0
		? `Use ${new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(labels)}`
		: null;
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

export function pricesForPlan(plan: PublicPricingPlan): TierPrices {
	return plan.prices;
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

export function buildPricingPlans(
	catalog: PublicPricingCatalog,
	modelCatalog: PricingModelCatalog | null = null
): PricingPlan[] {
	return catalog.plans.map((plan) => {
		const configuredFeatures = Array.isArray(plan.features)
			? plan.features.map((feature) => feature.trim()).filter(Boolean)
			: [];
		const configuredDescription = plan.description?.trim();
		const availableModels = modelCatalog ? modelFeature(modelCatalog, plan.id) : null;
		const features = [
			...(plan.id === 'free' ? ['No credit card required'] : []),
			usageFeature(plan.monthlyUsageDollars),
			...(availableModels ? [availableModels] : []),
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
			'Yes. The Free plan includes selected models and AI usage limits that reset Monday at 00:00 UTC and on the first of each month at 00:00 UTC. Sign in to start, no card required.'
	},
	{
		question: 'What happens when I reach an AI usage limit?',
		answer:
			'Metered models pause until your weekly or monthly usage window resets. Unmetered models stay available. The run that hits the limit stops, and the model picker switches to models available on your plan.'
	},
	{
		question: 'When does my paid monthly AI usage reset?',
		answer:
			'Monthly subscribers reset on their billing date. Annual subscribers reset each month at the UTC day and time their paid annual term began. If a month has fewer days, usage resets on its last day, then returns to the original day in later months. Weekly limits always reset Monday at 00:00 UTC.'
	},
	{
		question: 'How do I change plans or cancel?',
		answer:
			'Open Manage billing on your current plan to change tiers or cancel. Upgrades start after successful payment, with credit for unused paid time and a fresh usage allowance. Downgrades and cancellations take effect at your next billing date. There is no mid-term refund.'
	},
	{
		question: 'Can I switch between monthly and annual billing?',
		answer:
			'Not during an active subscription. Cancel your current subscription in Manage billing, keep your plan until the next billing date, then choose the other billing interval after that subscription ends. You will complete a new checkout.'
	}
];

export function isBillingInterval(value: string | null | undefined): value is BillingInterval {
	return value === 'monthly' || value === 'annual';
}
