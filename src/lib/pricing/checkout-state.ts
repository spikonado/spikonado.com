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
	authenticated: boolean;
	userLabel: string | null;
	message: string | null;
	busy: boolean;
};

export function createInitialPricingState(): PricingUiState {
	return {
		status: 'loading',
		tier: 'free',
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
		userLabel: string | null;
		message?: string | null;
	}
): PricingUiState {
	return {
		...state,
		status: 'idle',
		authenticated: input.authenticated,
		tier: input.tier,
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

export function withActivatedPro(state: PricingUiState): PricingUiState {
	return {
		...state,
		status: 'idle',
		tier: 'pro',
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
	return !state.busy && state.tier !== 'pro' && state.tier !== 'admin';
}

export function showsManageBilling(state: PricingUiState): boolean {
	return state.authenticated && (state.tier === 'pro' || state.tier === 'admin');
}
