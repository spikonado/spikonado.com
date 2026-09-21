import { createClient, type User } from '@workos-inc/authkit-js';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import {
	api,
	type BillingInterval,
	type PublicPricingCatalog,
	type SubscriptionTier
} from '@/lib/convex/api';

type AuthClient = Awaited<ReturnType<typeof createClient>>;

export type { BillingInterval, PublicPricingCatalog, SubscriptionTier };

export type MySubscription = {
	tier: SubscriptionTier;
	billingManaged: boolean;
};

export type PricingBillingClient = {
	convex: ConvexClient;
	auth: AuthClient | null;
	user: User | null;
	isReady: boolean;
	isConfigured: boolean;
	error: string | null;
};

let clientPromise: Promise<PricingBillingClient> | null = null;

function pricingCallbackUri(): string {
	return `${window.location.origin}/pricing/callback`;
}

export function requireConvexUrl(): string {
	const url = import.meta.env.PUBLIC_CONVEX_URL?.trim();
	if (!url) {
		throw new Error('Billing is not configured (missing PUBLIC_CONVEX_URL).');
	}
	return url;
}

function requireAuth(client: PricingBillingClient): AuthClient {
	if (!client.auth || !client.isConfigured) {
		throw new Error(client.error ?? 'Sign-in is not configured.');
	}
	return client.auth;
}

/** Unauthenticated catalog fetch for SSR/build and the pricing island. */
export async function fetchPublicPricingCatalog(
	convexUrl: string = requireConvexUrl()
): Promise<PublicPricingCatalog> {
	const client = new ConvexHttpClient(convexUrl);
	return await client.action(api.pricing.getPublicCatalog, {});
}

export async function initializePricingBilling(
	options: {
		onRedirectCallback?: () => void;
	} = {}
): Promise<PricingBillingClient> {
	if (typeof window === 'undefined') {
		throw new Error('Pricing billing is browser-only.');
	}
	if (clientPromise) return clientPromise;

	clientPromise = (async () => {
		const convexUrl = requireConvexUrl();
		// HTTP bootstrap so sign-in does not wait on the Convex websocket.
		const bootstrap = await new ConvexHttpClient(convexUrl).query(
			api.authBootstrap.getClientConfig,
			{}
		);
		const convex = new ConvexClient(convexUrl);
		const clientId = bootstrap.workosClientId?.trim();
		if (!clientId) {
			return {
				convex,
				auth: null,
				user: null,
				isReady: true,
				isConfigured: false,
				error: 'Sign-in is not configured yet.'
			};
		}

		const auth = await createClient(clientId, {
			redirectUri: pricingCallbackUri(),
			onRedirectCallback: () => {
				options.onRedirectCallback?.();
			}
		});

		convex.setAuth(async ({ forceRefreshToken }) => {
			try {
				const token = await auth.getAccessToken({ forceRefresh: forceRefreshToken });
				return token ?? undefined;
			} catch {
				return undefined;
			}
		});

		return {
			convex,
			auth,
			user: auth.getUser(),
			isReady: true,
			isConfigured: true,
			error: null
		};
	})().catch((error) => {
		clientPromise = null;
		throw error;
	});

	return clientPromise;
}

export async function signInForPricing(): Promise<void> {
	const client = await initializePricingBilling();
	await requireAuth(client).signIn();
}

export async function signOutOfPricing(): Promise<void> {
	const client = await initializePricingBilling();
	if (!client.auth) return;
	await client.auth.signOut({
		navigate: false,
		returnTo: `${window.location.origin}/pricing`
	});
	client.convex.close();
	clientPromise = null;
}

export async function fetchMySubscription(): Promise<MySubscription> {
	const client = await initializePricingBilling();
	if (!client.user) return { tier: 'free', billingManaged: false };
	const result = await client.convex.query(api.billing.getMySubscription, {});
	return { tier: result.tier, billingManaged: result.billingManaged };
}

export async function createProCheckout(interval: BillingInterval): Promise<string> {
	const client = await initializePricingBilling();
	if (!client.user) throw new Error('Sign in to upgrade to Pro.');
	const result = await client.convex.action(api.billing.checkout, {
		tier: 'pro',
		interval
	});
	if (!result.checkout_url) throw new Error('Checkout session was not created.');
	return result.checkout_url;
}

export async function openCustomerPortal(): Promise<string> {
	const client = await initializePricingBilling();
	if (!client.user) throw new Error('Sign in to manage billing.');
	const result = await client.convex.action(api.billing.customerPortal, {});
	if (!result.portal_url) throw new Error('Billing portal is not available yet.');
	return result.portal_url;
}

export function resetPricingBillingForTests(): void {
	clientPromise = null;
}
