import type { PublicPricingCatalog } from '@/lib/convex/api';

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

function usageFeature(amount: number): string {
	return `${formatPrice(amount, 'USD')} of AI usage each month`;
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

export function formatPrice(amountMajor: number, currency: string): string {
	const exponent = currencyMinorExponent(currency);
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: currency.trim().toUpperCase(),
		minimumFractionDigits: Number.isInteger(amountMajor) ? 0 : exponent,
		maximumFractionDigits: exponent
	}).format(amountMajor);
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
			description: configuredDescription || '',
			highlighted: plan.highlighted ?? false,
			features: [...new Set(features)]
		};
	});
}

export const pricingFaqs: PricingFaq[] = [
	{
		question: 'What are my payment options?',
		answer:
			'Credit and debit cards, UPI, Apple Pay, Google Pay, Cash App Pay, Klarna, RuPay, Satispay, Kakao Pay, Naver Pay, and Pix. Checkout shows the options available in your country and currency.'
	}
];

export function isBillingInterval(value: string | null | undefined): value is BillingInterval {
	return value === 'monthly' || value === 'annual';
}
