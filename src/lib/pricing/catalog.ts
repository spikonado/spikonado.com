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
	return `${formatCompactMoney(amount, 'USD')} of AI usage each month`;
}

/**
 * Dodo charges in the currency's minor units. Only Dodo's documented
 * supported currencies may be rendered; the exponent is the ISO 4217 minor
 * unit, stated explicitly so an unknown or unsupported code fails loudly
 * instead of falling back to a guessed /100 conversion.
 */
const SUPPORTED_CURRENCY_EXPONENTS: Record<string, number> = {
	USD: 2,
	EUR: 2,
	GBP: 2,
	CAD: 2,
	AUD: 2,
	INR: 2,
	JPY: 0,
	KRW: 0,
	CHF: 2,
	AED: 2,
	SAR: 2,
	SGD: 2,
	HKD: 2,
	CNY: 2,
	TWD: 2,
	IDR: 2,
	BRL: 2,
	MXN: 2,
	ALL: 2,
	AMD: 2,
	AWG: 2,
	AZN: 2,
	BAM: 2,
	BDT: 2,
	BMD: 2,
	BND: 2,
	BOB: 2,
	BSD: 2,
	BWP: 2,
	BZD: 2,
	CLP: 0,
	CRC: 2,
	CZK: 2,
	DKK: 2,
	DOP: 2,
	EGP: 2,
	ETB: 2,
	FJD: 2,
	GEL: 2,
	GMD: 2,
	GTQ: 2,
	GYD: 2,
	HNL: 2,
	HUF: 2,
	ILS: 2,
	KZT: 2,
	LKR: 2,
	LRD: 2,
	LSL: 2,
	MAD: 2,
	MKD: 2,
	MOP: 2,
	MUR: 2,
	MVR: 2,
	MWK: 2,
	MYR: 2,
	NGN: 2,
	NOK: 2,
	NPR: 2,
	NZD: 2,
	PEN: 2,
	PGK: 2,
	PHP: 2,
	PLN: 2,
	PYG: 0,
	QAR: 2,
	RON: 2,
	RSD: 2,
	SBD: 2,
	SCR: 2,
	SEK: 2,
	SZL: 2,
	THB: 2,
	TOP: 2,
	TRY: 2,
	TZS: 2,
	UYU: 2,
	VND: 0,
	WST: 2,
	XAF: 0,
	XOF: 0,
	ZAR: 2,
	ZMW: 2,
	// Three-decimal currencies supported by Dodo.
	KWD: 3,
	BHD: 3,
	OMR: 3,
	JOD: 3
};

export function currencyMinorExponent(currency: string): number {
	const exponent = SUPPORTED_CURRENCY_EXPONENTS[currency.trim().toUpperCase()];
	if (exponent === undefined) throw new Error(`Unsupported currency "${currency}".`);
	return exponent;
}

export function majorFromMinor(amountMinor: number, currency: string): number {
	return amountMinor / 10 ** currencyMinorExponent(currency);
}

function formatMoney(amountMajor: number, currency: string): string {
	const exponent = currencyMinorExponent(currency);
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		minimumFractionDigits: exponent,
		maximumFractionDigits: exponent
	}).format(amountMajor);
}

/**
 * Compact copy (e.g. usage feature lines) omits fractional digits for whole
 * major-unit amounts so cards read "$15" rather than "$15.00". Non-whole
 * amounts keep the currency's exact exponent.
 */
function formatCompactMoney(amountMajor: number, currency: string): string {
	const exponent = currencyMinorExponent(currency);
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		minimumFractionDigits: Number.isInteger(amountMajor) ? 0 : exponent,
		maximumFractionDigits: exponent
	}).format(amountMajor);
}

/**
 * Distinct currencies can share one narrow symbol (USD/CAD/AUD all render
 * "$"), so card footers name the ISO code explicitly for those. A currency
 * whose narrow symbol is just its code (KWD, CHF) already names itself.
 */
export function currencyCodeLabel(currency: string): string {
	const exponent = currencyMinorExponent(currency);
	const normalized = currency.trim().toUpperCase();
	const parts = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: normalized,
		currencyDisplay: 'narrowSymbol',
		maximumFractionDigits: exponent,
		minimumFractionDigits: exponent
	}).formatToParts(0);
	const symbol = parts.find((part) => part.type === 'currency')?.value ?? currency;
	return symbol === '$' ? `${symbol} ${normalized}` : symbol;
}

/** Normalize a Dodo recurring price into a monthly-equivalent major-unit amount. */
export function monthlyEquivalentMajor(price: DodoPublicPrice): number {
	const total = majorFromMinor(price.amountMinor, price.currency);
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
	const periodMajor = majorFromMinor(price.amountMinor, price.currency);
	const money = formatMoney(perMonth, price.currency);
	const periodLabel = formatMoney(periodMajor, price.currency);
	if (interval === 'annual') {
		const monthly = prices.monthly;
		const monthlyTimes12 =
			monthly && monthly.currency === price.currency ? monthlyEquivalentMajor(monthly) * 12 : null;
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
		const configuredFeatures = Array.isArray(plan.features)
			? plan.features.map((feature) => feature.trim()).filter(Boolean)
			: [];
		const configuredDescription = plan.description?.trim();
		const features = [
			...(plan.id === 'free' ? ['No credit card required'] : []),
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
	},
	{
		question: 'How do I get billing help, a refund, or dispute a charge?',
		answer:
			'Email aarav@spikonado.com. Refunds and disputes are handled through Dodo and the support inbox — there is no mid-term self-service refund. Manage billing shows your invoices and payment methods.'
	}
];

export const pricingBasePriceCaveat =
	'Base prices. Checkout determines the final price, including applicable tax, discounts, regional pricing, and trials.';

export function isBillingInterval(value: string | null | undefined): value is BillingInterval {
	return value === 'monthly' || value === 'annual';
}
