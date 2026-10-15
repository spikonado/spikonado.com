import { anyApi, type FunctionReference } from 'convex/server';

// Hand-maintained subset of the public Convex functions in spikonado/sprocket (apps/web/convex).
// Update it when those signatures change: https://docs.convex.dev/production/multiple-repos

export type BillingInterval = 'monthly' | 'annual';
export type CheckoutMode = 'test' | 'live';

export type DodoPrice = { amountMinor: number; currency: string };

export type PublicPricingPlan = {
	id: string;
	label: string;
	monthlyUsageDollars: number;
	description: string | null;
	features: string[];
	highlighted: boolean;
	prices: Record<BillingInterval, DodoPrice | null>;
};

export type PublicPricingCatalog = { plans: PublicPricingPlan[] };

export type MySubscription = { tier: string; tierLabel: string; billingManaged: boolean };

export type CheckoutStatus = {
	status: 'awaiting_payment' | 'pending' | 'succeeded' | 'failed' | 'expired' | 'unknown';
	mode: CheckoutMode;
	activated?: boolean;
	checkout_url?: string;
};

type Empty = Record<string, never>;

type PublicApi = {
	authBootstrap: {
		getClientConfig: FunctionReference<'query', 'public', Empty, { workosClientId: string }>;
	};
	billing: {
		getMySubscription: FunctionReference<'query', 'public', Empty, MySubscription>;
		checkout: FunctionReference<
			'action',
			'public',
			{ tier: string; interval: BillingInterval },
			{ checkout_url: string; mode: CheckoutMode; attemptId?: string }
		>;
		customerPortal: FunctionReference<'action', 'public', Empty, { portal_url: string }>;
		getCheckoutStatus: FunctionReference<'action', 'public', { attemptId: string }, CheckoutStatus>;
	};
	pricing: {
		getPublicCatalog: FunctionReference<'action', 'public', Empty, PublicPricingCatalog>;
	};
};

export const api = anyApi as unknown as PublicApi;
