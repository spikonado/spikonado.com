/**
 * Typed Convex public API for the Sprocket deployment.
 * Generated/updated via `bun run sync:convex-api` (convex-helpers ts-api-spec).
 * @see https://docs.convex.dev/production/multiple-repos
 */
import { type FunctionReference, anyApi } from 'convex/server';

export const api: PublicApiType = anyApi as unknown as PublicApiType;

export type BillingInterval = 'monthly' | 'annual';
export type SubscriptionTier = string;
export type PublicPlanId = 'free' | 'pro';
export type DodoPublicPrice = {
	productId: string;
	name: string | null;
	amountMinor: number;
	currency: string;
	paymentFrequencyCount: number;
	paymentFrequencyInterval: string;
};

export type PublicPricingPlan = {
	id: PublicPlanId;
	label: string;
	monthlyUsageDollars: number;
};

export type PublicPricingCatalog = {
	plans: PublicPricingPlan[];
	/** Pro prices from Dodo; null when payments are not configured. */
	proPrices: {
		monthly: DodoPublicPrice;
		annual: DodoPublicPrice;
	} | null;
};

export type PublicApiType = {
	authBootstrap: {
		getClientConfig: FunctionReference<
			'query',
			'public',
			Record<string, never>,
			{ workosClientId: string | null }
		>;
	};
	billing: {
		getMySubscription: FunctionReference<
			'query',
			'public',
			Record<string, never>,
			{ tier: SubscriptionTier; tierLabel: string; billingManaged: boolean }
		>;
		ensureMySubscription: FunctionReference<'mutation', 'public', Record<string, never>, null>;
		checkout: FunctionReference<
			'action',
			'public',
			{ tier: 'pro'; interval: BillingInterval },
			{ checkout_url: string }
		>;
		customerPortal: FunctionReference<
			'action',
			'public',
			Record<string, never>,
			{ portal_url: string }
		>;
	};
	pricing: {
		getPublicCatalog: FunctionReference<
			'action',
			'public',
			Record<string, never>,
			PublicPricingCatalog
		>;
	};
};
