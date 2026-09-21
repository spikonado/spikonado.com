import type { DodoPublicPrice, PublicPricingCatalog } from '@/lib/convex/api';

/** Marketing catalog for Sprocket plans. Entitlement copy is built from live Convex data. */

export const billingIntervalIds = ['monthly', 'annual'] as const;
export type BillingInterval = (typeof billingIntervalIds)[number];

export const publicPlanIds = ['free', 'pro', 'enterprise'] as const;
export type PublicPlanId = (typeof publicPlanIds)[number];

export const ENTERPRISE_SALES_EMAIL = 'aarav@spikonado.com';
export const ENTERPRISE_MAILTO = `mailto:${ENTERPRISE_SALES_EMAIL}`;

export type PricingPlan = {
	id: PublicPlanId;
	name: string;
	/** Intro line above the feature list, e.g. "Includes:" */
	includesLabel: string;
	highlighted?: boolean;
	features: string[];
};

export type PricingFaq = {
	question: string;
	answer: string;
};

export type ProPriceDisplay = {
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

function formatCount(value: number): string {
	return value.toLocaleString('en-US');
}

function creditFeature(amount: number | null): string | null {
	if (amount === null) return null;
	return `${formatCount(amount)} monthly AI usage credits`;
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

export function proPriceLabel(
	interval: BillingInterval,
	proPrices: PublicPricingCatalog['proPrices']
): ProPriceDisplay | null {
	if (!proPrices) return null;
	const price = proPrices[interval];
	const perMonth = monthlyEquivalentMajor(price);
	const periodMajor = majorFromMinor(price.amountMinor);
	const money = formatMoney(perMonth, price.currency);
	const periodLabel = formatMoney(periodMajor, price.currency);
	if (interval === 'annual') {
		const monthlyTimes12 = monthlyEquivalentMajor(proPrices.monthly) * 12;
		const compareAt =
			monthlyTimes12 > periodMajor ? formatMoney(monthlyTimes12, price.currency) : null;
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
	const free = catalog.plans.find((plan) => plan.id === 'free');
	const pro = catalog.plans.find((plan) => plan.id === 'pro');
	if (!free || !pro) {
		throw new Error('Pricing catalog is missing free or pro plans.');
	}

	const freeCredits = creditFeature(free.limits.modelUsage);
	const proCredits = creditFeature(pro.limits.modelUsage);

	return [
		{
			id: 'free',
			name: free.label,
			includesLabel: 'Includes:',
			features: [
				'No credit card required',
				...(freeCredits ? [freeCredits] : []),
				'No extra charge for any feature',
				'Unlimited use of everything except AI',
				'Access to selected models'
			]
		},
		{
			id: 'pro',
			name: pro.label,
			includesLabel: 'Everything in Free, plus:',
			highlighted: true,
			features: [
				...(proCredits ? [proCredits] : []),
				'Access to our complete AI model catalog',
				'Access AI models at faster service tiers'
			]
		},
		{
			id: 'enterprise',
			name: 'Enterprise',
			includesLabel: 'Everything in Pro, plus:',
			features: [
				'Custom usage and model access',
				'Volume pricing and procurement support',
				'Direct sales contact for rollout planning'
			]
		}
	];
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
			'Metered models pause on Free until your usage window resets. Unlimited models stay available. Pro keeps standard models. The run that hits the limit stops, and the model picker switches to those models.'
	}
];

export function isBillingInterval(value: string | null | undefined): value is BillingInterval {
	return value === 'monthly' || value === 'annual';
}
