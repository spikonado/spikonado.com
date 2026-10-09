import { createClient, type User } from '@workos-inc/authkit-js';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import {
	api,
	type AccessPhase,
	type BillingInterval,
	type CheckoutAttemptStatus,
	type PublicPricingCatalog,
	type SubscriptionTier
} from '@/lib/convex/api';
import { storeCheckoutAttempt } from '@/lib/pricing/pending';
import { resolveCheckoutMode, type DodoCheckoutMode } from '@/lib/pricing/config';
import { pricingAuthOptions } from '@/lib/pricing/auth-config';

type AuthClient = Awaited<ReturnType<typeof createClient>>;

export type {
	AccessPhase,
	BillingInterval,
	CheckoutAttemptStatus,
	PublicPricingCatalog,
	SubscriptionTier
};

export type MySubscription = {
	tier: SubscriptionTier;
	tierLabel: string;
	billingManaged: boolean;
	accessPhase?: AccessPhase;
};

export type CheckoutResult = {
	checkoutUrl: string;
	attemptId: string;
	sessionId?: string;
};

/**
 * Server-reported, account-bound attempt status. "succeeded" only means the
 * provider reports payment; entitlement arrives via the signed webhook, so it
 * is never displayed as activation by itself.
 */
export type CheckoutStatus = {
	attemptId: string;
	status: CheckoutAttemptStatus;
	checkout_url?: string;
	sessionId?: string;
	expiresAt?: number;
	activated?: boolean;
};

export type PricingBillingClient = {
	convex: ConvexClient;
	auth: AuthClient | null;
	isConfigured: boolean;
	error: string | null;
};

let clientPromise: Promise<PricingBillingClient> | null = null;

function pricingCallbackUri(): string {
	return `${window.location.origin}/pricing/callback`;
}

function pricingHttpClient(url: string): ConvexHttpClient {
	return new ConvexHttpClient(url, {
		fetch: ((input, init) =>
			fetch(input, { ...init, signal: AbortSignal.timeout(12_000) })) as typeof fetch
	});
}

export function requireConvexUrl(): string {
	const url = import.meta.env.PUBLIC_CONVEX_URL?.trim();
	if (!url) {
		throw new Error('Billing is not configured (missing PUBLIC_CONVEX_URL).');
	}
	return url;
}

/**
 * The live signed-in user, always read from the auth client rather than the
 * snapshot captured at initialization. Account state can change after the
 * client is built (sign-out, account replacement, token refresh), so callers
 * must never act on a stale cached user.
 */
function liveUser(client: PricingBillingClient): User | null {
	if (!client.auth || !client.isConfigured) return null;
	try {
		return client.auth.getUser();
	} catch {
		return null;
	}
}

function accountIdFor(user: User): string {
	return user.id ?? user.email ?? '';
}

/** Unauthenticated catalog fetch for SSR/build and the pricing island. */
export async function fetchPublicPricingCatalog(
	convexUrl: string = requireConvexUrl()
): Promise<PublicPricingCatalog> {
	const client = pricingHttpClient(convexUrl);
	return await client.action(api.pricing.getPublicCatalog, {});
}

export async function initializePricingBilling(): Promise<PricingBillingClient> {
	if (typeof window === 'undefined') {
		throw new Error('Pricing billing is browser-only.');
	}
	if (clientPromise) return clientPromise;

	clientPromise = (async () => {
		const convexUrl = requireConvexUrl();
		// HTTP bootstrap so sign-in does not wait on the Convex websocket.
		const bootstrap = await pricingHttpClient(convexUrl).query(
			api.authBootstrap.getClientConfig,
			{}
		);
		const clientId = bootstrap.workosClientId?.trim();
		if (!clientId) {
			return {
				convex: new ConvexClient(convexUrl),
				auth: null,
				isConfigured: false,
				error: 'Sign-in is not configured yet.'
			};
		}

		const auth = await createClient(clientId, {
			...pricingAuthOptions(),
			redirectUri: pricingCallbackUri()
		});

		const convex = new ConvexClient(convexUrl);
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
	const auth = client.auth;
	if (!auth || !client.isConfigured) {
		throw new Error(client.error ?? 'Sign-in is not configured.');
	}
	await auth.signIn();
}

export async function signOutOfPricing(): Promise<void> {
	const client = await initializePricingBilling();
	if (!client.auth) return;
	await client.auth.signOut({
		navigate: false,
		returnTo: `${window.location.origin}/pricing`
	});
	void client.convex.close();
	client.auth.dispose();
	clientPromise = null;
}

export async function fetchMySubscription(expectedAccountId?: string): Promise<MySubscription> {
	const client = await initializePricingBilling();
	const initiator = liveUser(client);
	if (!initiator) {
		return {
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: false
		};
	}
	if (expectedAccountId && accountIdFor(initiator) !== expectedAccountId) {
		throw new Error('This billing action was cancelled.');
	}
	const result = await client.convex.query(api.billing.getMySubscription, {});
	// The query result is scoped to the authenticated account at request time;
	// a sign-out or account switch during the query makes the result stale.
	const current = liveUser(client);
	if (!current || accountIdFor(current) !== accountIdFor(initiator)) {
		throw new Error('This billing action was cancelled.');
	}
	return {
		tier: result.tier,
		tierLabel: result.tierLabel,
		billingManaged: result.billingManaged,
		accessPhase: result.accessPhase
	};
}

/**
 * The checkout/status payloads carry the backend Dodo environment. Anything
 * unrecognized stays undefined so the mode check below fails closed instead of
 * assuming agreement.
 */
function normalizeBackendMode(value: unknown): DodoCheckoutMode | undefined {
	if (value === 'test') return 'test';
	if (value === 'live') return 'live';
	return undefined;
}

/**
 * Throws unless the frontend checkout mode agrees with the backend-confirmed
 * Dodo mode carried by a checkout or status payload. An absent mode fails
 * closed: the hosted URL is never opened against an unconfirmed environment.
 */
function assertReturnedCheckoutMode(backendMode: DodoCheckoutMode | undefined): void {
	const frontendMode = resolveCheckoutMode();
	if (backendMode === undefined) {
		throw new Error(
			'Checkout did not report its billing mode. Cannot verify that PUBLIC_DODO_CHECKOUT_MODE matches the backend Dodo environment.'
		);
	}
	if (frontendMode !== backendMode) {
		throw new Error(
			`Checkout is configured in ${frontendMode} mode but this checkout link is ${backendMode} mode. Fix PUBLIC_DODO_CHECKOUT_MODE to match the billing backend.`
		);
	}
}

function assertCheckoutUrl(url: string, mode: DodoCheckoutMode | undefined): void {
	assertReturnedCheckoutMode(mode);
	const parsed = new URL(url);
	const origin =
		mode === 'live'
			? 'https://checkout.dodopayments.com'
			: 'https://test.checkout.dodopayments.com';
	if (parsed.origin !== origin || parsed.username || parsed.password) {
		throw new Error('Checkout returned an invalid hosted URL. Contact billing support.');
	}
}

export async function createCheckout(
	tierId: string,
	interval: BillingInterval,
	expectedAccountId?: string,
	isCurrent: () => boolean = () => true
): Promise<CheckoutResult> {
	const client = await initializePricingBilling();
	if (!isCurrent()) throw new Error('This billing action was cancelled.');
	const initiator = liveUser(client);
	if (!initiator) throw new Error('Sign in to choose a paid plan.');
	const initiatorAccount = accountIdFor(initiator);
	if (expectedAccountId && initiatorAccount !== expectedAccountId) {
		throw new Error('This billing action was cancelled.');
	}
	const result = await client.convex.action(api.billing.checkout, {
		tier: tierId,
		interval
	});
	if (!isCurrent()) throw new Error('This billing action was cancelled.');
	// Persist the attempt only while the initiating account still owns the
	// session: a switched account throws instead of receiving a checkout URL
	// it must not open.
	const current = liveUser(client);
	if (!current || accountIdFor(current) !== initiatorAccount) {
		throw new Error('This billing action was cancelled.');
	}
	if (!result.attemptId?.trim()) {
		throw new Error('Checkout recovery is unavailable. Contact billing support before paying.');
	}
	// Persist the account-bound attempt reference before any validation that
	// can strand recovery (mode disagreement, missing URL): once the provider
	// session exists, status lookups must stay possible.
	storeCheckoutAttempt(accountIdFor(current), {
		attemptId: result.attemptId,
		tierId,
		interval
	});
	if (!result.checkout_url) throw new Error('Checkout session was not created.');
	assertCheckoutUrl(result.checkout_url, normalizeBackendMode(result.mode));
	return {
		checkoutUrl: result.checkout_url,
		attemptId: result.attemptId,
		sessionId: result.sessionId
	};
}

/**
 * Neutral, account-bound recovery lookup for a checkout attempt. The server
 * verifies ownership; an unknown attempt throws and must never be treated as
 * proof of payment or entitlement.
 */
export async function fetchCheckoutStatus(
	attemptId: string,
	expectedAccountId?: string
): Promise<CheckoutStatus> {
	const client = await initializePricingBilling();
	const initiator = liveUser(client);
	if (!initiator) throw new Error('Sign in to check checkout status.');
	const initiatorAccount = accountIdFor(initiator);
	if (expectedAccountId && initiatorAccount !== expectedAccountId) {
		throw new Error('This billing action was cancelled.');
	}
	const result = await client.convex.action(api.billing.getCheckoutStatus, { attemptId });
	const current = liveUser(client);
	if (!current || accountIdFor(current) !== initiatorAccount) {
		throw new Error('This billing action was cancelled.');
	}
	// A resumable URL is only handed out when its provider environment agrees
	// with the frontend; anything else fails closed before it can be opened.
	if (typeof result.checkout_url === 'string' && result.checkout_url.trim()) {
		assertCheckoutUrl(result.checkout_url, normalizeBackendMode(result.mode));
	}
	return result;
}

export async function openCustomerPortal(expectedAccountId?: string): Promise<string> {
	const client = await initializePricingBilling();
	const initiator = liveUser(client);
	if (!initiator) throw new Error('Sign in to manage billing.');
	const initiatorAccount = accountIdFor(initiator);
	if (expectedAccountId && initiatorAccount !== expectedAccountId) {
		throw new Error('This billing action was cancelled.');
	}
	const result = await client.convex.action(api.billing.customerPortal, {});
	const current = liveUser(client);
	if (!current || accountIdFor(current) !== initiatorAccount) {
		throw new Error('This billing action was cancelled.');
	}
	if (!result.portal_url) throw new Error('Billing portal is not available yet.');
	return result.portal_url;
}

export function resetPricingBillingForTests(): void {
	clientPromise = null;
}
