import { createClient, type User } from '@workos-inc/authkit-js';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import {
	api,
	type AccessPhase,
	type BillingInterval,
	type CheckoutAttemptStatus,
	type CheckoutEligibility,
	type PublicPricingCatalog,
	type SubscriptionTier
} from '@/lib/convex/api';
import { storeCheckoutAttempt } from '@/lib/pricing/pending';
import { resolveCheckoutMode, type DodoCheckoutMode } from '@/lib/pricing/config';

type AuthClient = Awaited<ReturnType<typeof createClient>>;

export type {
	AccessPhase,
	BillingInterval,
	CheckoutAttemptStatus,
	CheckoutEligibility,
	PublicPricingCatalog,
	SubscriptionTier
};

export type MySubscription = {
	tier: SubscriptionTier;
	tierLabel: string;
	billingManaged: boolean;
	checkoutEligibility?: CheckoutEligibility;
	accessPhase?: AccessPhase;
};

/**
 * Backend-confirmed checkout readiness and provider mode. Consumed additively:
 * `mode` is present once the backend ships it. When the backend does not
 * confirm a mode, the frontend must fail closed rather than assume agreement.
 */
export type CheckoutGate = {
	eligibility: CheckoutEligibility;
	checkoutEnabled: boolean;
	reason: string;
	mode?: DodoCheckoutMode;
};

export type CheckoutResult = {
	checkoutUrl: string;
	attemptId?: string;
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
		checkoutEligibility: result.checkoutEligibility,
		accessPhase: result.accessPhase
	};
}

function isCheckoutEligibilityValue(value: unknown): value is CheckoutEligibility {
	return (
		value === 'purchasable' ||
		value === 'active' ||
		value === 'repair_required' ||
		value === 'confirmation_pending' ||
		value === 'checkout_disabled'
	);
}

/**
 * The backend reports its Dodo environment ('test_mode' | 'live_mode'); the
 * overlay speaks 'test' | 'live'. Anything unrecognized stays undefined so the
 * mode check below fails closed instead of assuming agreement.
 */
function normalizeBackendMode(value: unknown): DodoCheckoutMode | undefined {
	if (value === 'test_mode' || value === 'test') return 'test';
	if (value === 'live_mode' || value === 'live') return 'live';
	return undefined;
}

/**
 * Authoritative checkout readiness and provider mode from the backend. The
 * backend enforces the checkout kill switch and its own Dodo environment; the
 * frontend must not offer checkout unless the backend reports it enabled and
 * the provider mode agrees with the configured overlay mode.
 */
export async function fetchCheckoutGate(expectedAccountId?: string): Promise<CheckoutGate> {
	const client = await initializePricingBilling();
	const initiator = liveUser(client);
	if (!initiator) {
		return {
			eligibility: 'purchasable',
			checkoutEnabled: true,
			reason: 'not signed in',
			mode: undefined
		};
	}
	if (expectedAccountId && accountIdFor(initiator) !== expectedAccountId) {
		throw new Error('This billing action was cancelled.');
	}
	const result = await client.convex.query(api.billing.checkoutEligibility, {});
	const current = liveUser(client);
	if (!current || accountIdFor(current) !== accountIdFor(initiator)) {
		throw new Error('This billing action was cancelled.');
	}
	return {
		eligibility: isCheckoutEligibilityValue(result.eligibility)
			? result.eligibility
			: 'purchasable',
		checkoutEnabled: result.checkoutEnabled === true,
		reason: typeof result.reason === 'string' ? result.reason : '',
		mode: normalizeBackendMode(result.mode)
	};
}

/**
 * Throws unless the frontend overlay mode agrees with the backend's confirmed
 * Dodo mode. Mode agreement is required before checkout: an absent backend
 * mode fails closed instead of assuming agreement.
 */
function assertCheckoutModeAgrees(backendMode: DodoCheckoutMode | undefined): void {
	const frontendMode = resolveCheckoutMode();
	if (backendMode === undefined) {
		throw new Error(
			'Checkout mode is not confirmed by the billing backend. Cannot verify that PUBLIC_DODO_CHECKOUT_MODE matches the backend Dodo environment.'
		);
	}
	if (frontendMode !== backendMode) {
		throw new Error(
			`Checkout is configured in ${frontendMode} mode but billing is running in ${backendMode} mode. Fix PUBLIC_DODO_CHECKOUT_MODE to match the billing backend.`
		);
	}
}

export async function createCheckout(
	tierId: string,
	interval: BillingInterval,
	expectedAccountId?: string
): Promise<CheckoutResult> {
	const client = await initializePricingBilling();
	const initiator = liveUser(client);
	if (!initiator) throw new Error('Sign in to choose a paid plan.');
	const initiatorAccount = accountIdFor(initiator);
	if (expectedAccountId && initiatorAccount !== expectedAccountId) {
		throw new Error('This billing action was cancelled.');
	}
	const gate = await fetchCheckoutGate(initiatorAccount);
	if (!gate.checkoutEnabled || gate.eligibility === 'checkout_disabled') {
		throw new Error('New purchases are temporarily unavailable.');
	}
	assertCheckoutModeAgrees(gate.mode);
	const result = await client.convex.action(api.billing.checkout, {
		tier: tierId,
		interval
	});
	if (!result.checkout_url) throw new Error('Checkout session was not created.');
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
	storeCheckoutAttempt(accountIdFor(current), {
		attemptId: result.attemptId,
		tierId,
		interval,
		startedAt: Date.now()
	});
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
