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
	tierLabel: string;
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
		tierLabel: 'Free',
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
		busy: false
	};
}

export function withActivationTimeout(state: PricingUiState, tierLabel: string): PricingUiState {
	return {
		...state,
		status: 'idle',
		message: `Payment received. ${tierLabel} activation is still confirming. Refresh in a moment if it has not updated yet.`,
		busy: false
	};
}

export function canStartCheckout(state: PricingUiState): boolean {
	return !state.busy && state.tier === 'free';
}

export function showsManageBilling(state: PricingUiState): boolean {
	return state.authenticated && state.billingManaged;
}
