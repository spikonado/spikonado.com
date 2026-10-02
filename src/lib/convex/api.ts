import { anyApi, type FunctionReference, type FunctionReturnType } from 'convex/server';
export type PublicApiType = {
	authBootstrap: {
		getClientConfig: FunctionReference<
			'query',
			'public',
			Record<string, never>,
			{ workosClientId: string }
		>;
	};
	billing: {
		getMySubscription: FunctionReference<
			'query',
			'public',
			Record<string, never>,
			{
				tier: string;
				tierLabel: string;
				billingManaged: boolean;
				accessPhase?: 'active' | 'scheduled_cancel' | 'ended' | 'none';
			}
		>;
		ensureMySubscription: FunctionReference<'mutation', 'public', Record<string, never>, null>;
		checkout: FunctionReference<
			'action',
			'public',
			{ tier: string; interval: 'monthly' | 'annual' },
			{ checkout_url: string; mode: 'test' | 'live'; attemptId?: string; sessionId?: string }
		>;
		customerPortal: FunctionReference<
			'action',
			'public',
			Record<string, never>,
			{ portal_url: string }
		>;
		getCheckoutStatus: FunctionReference<
			'action',
			'public',
			{ attemptId: string },
			{
				attemptId: string;
				status: 'awaiting_payment' | 'pending' | 'succeeded' | 'failed' | 'expired' | 'unknown';
				mode: 'test' | 'live';
				activated?: boolean;
				checkout_url?: string;
				sessionId?: string;
				expiresAt?: number;
			}
		>;
	};
	pricing: {
		getPublicCatalog: FunctionReference<
			'action',
			'public',
			Record<string, never>,
			{
				plans: Array<{
					id: string;
					label: string;
					weeklyUsageDollars: number;
					monthlyUsageDollars: number;
					description: string | null;
					features: Array<string>;
					displayOrder: number;
					highlighted: boolean;
					prices: {
						monthly: {
							productId: string;
							name: string | null;
							amountMinor: number;
							currency: string;
							paymentFrequencyCount: number;
							paymentFrequencyInterval: string;
						} | null;
						annual: {
							productId: string;
							name: string | null;
							amountMinor: number;
							currency: string;
							paymentFrequencyCount: number;
							paymentFrequencyInterval: string;
						} | null;
					};
				}>;
			}
		>;
	};
};
export const api: PublicApiType = anyApi as unknown as PublicApiType;
export type PublicPricingCatalog = FunctionReturnType<PublicApiType['pricing']['getPublicCatalog']>;
export type PublicPricingPlan = PublicPricingCatalog['plans'][number];
export type DodoPublicPrice = NonNullable<PublicPricingPlan['prices']['monthly']>;
export type PublicPlanId = PublicPricingPlan['id'];
export type SubscriptionTier = FunctionReturnType<
	PublicApiType['billing']['getMySubscription']
>['tier'];
export type BillingInterval = 'monthly' | 'annual';
export type AccessPhase = NonNullable<
	FunctionReturnType<PublicApiType['billing']['getMySubscription']>['accessPhase']
>;
export type CheckoutAttemptStatus = FunctionReturnType<
	PublicApiType['billing']['getCheckoutStatus']
>['status'];
