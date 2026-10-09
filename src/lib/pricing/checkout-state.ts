import type { SubscriptionTier } from '@/lib/pricing/billing-client';

export type PricingUiStatus =
	| 'idle'
	| 'loading'
	| 'signing_in'
	| 'starting_checkout'
	| 'redirecting'
	| 'activating'
	| 'managing_billing'
	| 'error';

export type PricingUiState = {
	status: PricingUiStatus;
	tier: SubscriptionTier;
	tierLabel: string;
	billingManaged: boolean;
	authenticated: boolean;
	userLabel: string | null;
	message: string | null;
	busy: boolean;
	/** Account-owned attempt awaiting payment or activation; drives resume/status UI. */
	pendingAttemptId: string | null;
	/** Server-confirmed URL for reopening the pending attempt's checkout. */
	pendingCheckoutUrl: string | null;
};

export function createInitialPricingState(): PricingUiState {
	return {
		status: 'loading',
		tier: 'free',
		tierLabel: 'Free',
		billingManaged: false,
		authenticated: false,
		userLabel: null,
		message: null,
		busy: true,
		pendingAttemptId: null,
		pendingCheckoutUrl: null
	};
}

export function withReadySession(
	state: PricingUiState,
	input: {
		authenticated: boolean;
		tier: SubscriptionTier;
		tierLabel: string;
		billingManaged: boolean;
		userLabel: string | null;
		message?: string | null;
	}
): PricingUiState {
	return {
		...state,
		status: 'idle',
		authenticated: input.authenticated,
		tier: input.tier,
		tierLabel: input.tierLabel,
		billingManaged: input.billingManaged,
		userLabel: input.userLabel,
		message: input.message ?? null,
		busy: false,
		pendingAttemptId: null,
		pendingCheckoutUrl: null
	};
}

export function withBusyStatus(
	state: PricingUiState,
	status: Exclude<PricingUiStatus, 'idle' | 'error'>,
	message: string | null = null
): PricingUiState {
	return {
		...state,
		status,
		message,
		busy: true
	};
}

export function withError(state: PricingUiState, message: string): PricingUiState {
	return {
		...state,
		status: 'error',
		message,
		busy: false
	};
}

export function withReadyStatus(
	state: PricingUiState,
	message: string | null = null
): PricingUiState {
	return {
		...state,
		status: 'idle',
		message,
		busy: false
	};
}

export function withActivatedTier(
	state: PricingUiState,
	tier: SubscriptionTier,
	tierLabel: string
): PricingUiState {
	return {
		...state,
		status: 'idle',
		authenticated: true,
		tier,
		tierLabel,
		billingManaged: true,
		message: `${tierLabel} is active. You can manage billing anytime from this page.`,
		busy: false,
		pendingAttemptId: null,
		pendingCheckoutUrl: null
	};
}

/**
 * The account owns an attempt whose payment is not confirmed. When the server
 * reports the attempt still awaiting payment it also returns the authorized
 * checkout URL, which the UI offers as an explicit "Continue checkout" resume
 * instead of creating a new session.
 */
export function withPaymentPending(
	state: PricingUiState,
	tierLabel: string,
	attemptId: string,
	checkoutUrl: string | null
): PricingUiState {
	return {
		...state,
		status: 'idle',
		pendingAttemptId: attemptId,
		pendingCheckoutUrl: checkoutUrl,
		message: `We could not confirm your ${tierLabel} payment yet. Use "Check payment status" below to check again — no new purchase will be started.`,
		busy: false
	};
}

// Duplicate protection lives at the provider; only an in-flight operation
// (creation, activation, portal navigation) blocks a new selection.
export function canStartCheckout(state: PricingUiState): boolean {
	return !state.busy;
}

export function showsManageBilling(state: PricingUiState): boolean {
	return state.authenticated && state.billingManaged;
}
