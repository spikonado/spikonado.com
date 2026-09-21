import type { SubscriptionTier } from '@/lib/pricing/billing-client';

export type PricingUiStatus =
	| 'idle'
	| 'loading'
	| 'signing_in'
	| 'starting_checkout'
	| 'checkout_open'
	| 'activating'
	| 'managing_billing'
	| 'error';

export type PricingUiState = {
	status: PricingUiStatus;
	tier: SubscriptionTier;
	billingManaged: boolean;
	authenticated: boolean;
	userLabel: string | null;
	message: string | null;
	busy: boolean;
};

export function createInitialPricingState(): PricingUiState {
	return {
		status: 'loading',
		tier: 'free',
		billingManaged: false,
		authenticated: false,
		userLabel: null,
		message: null,
		busy: true
	};
}

export function withReadySession(
	state: PricingUiState,
	input: {
		authenticated: boolean;
		tier: SubscriptionTier;
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
		billingManaged: input.billingManaged,
		userLabel: input.userLabel,
		message: input.message ?? null,
		busy: false
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

export function withActivatedPro(state: PricingUiState): PricingUiState {
	return {
		...state,
		status: 'idle',
		tier: 'pro',
		billingManaged: true,
		message: 'Pro is active. You can manage billing anytime from this page.',
		busy: false
	};
}

export function withActivationTimeout(state: PricingUiState): PricingUiState {
	return {
		...state,
		status: 'idle',
		message:
			'Payment received. Pro activation is still confirming—refresh in a moment if it has not updated yet.',
		busy: false
	};
}

export function canStartCheckout(state: PricingUiState): boolean {
	return !state.busy && state.tier === 'free';
}

export function showsManageBilling(state: PricingUiState): boolean {
	return state.authenticated && state.billingManaged;
}
