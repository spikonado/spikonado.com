import type { AccessPhase, CheckoutEligibility } from '@/lib/convex/api';
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
	checkoutEligibility: CheckoutEligibility | null;
	accessPhase: AccessPhase | null;
	authenticated: boolean;
	userLabel: string | null;
	message: string | null;
	busy: boolean;
	/** Account-owned attempt awaiting activation; required for status checks. */
	pendingAttemptId: string | null;
};

export function isAccessPhase(value: unknown): value is AccessPhase {
	return (
		value === 'active' || value === 'scheduled_cancel' || value === 'ended' || value === 'none'
	);
}

export function isCheckoutEligibility(value: unknown): value is CheckoutEligibility {
	return (
		value === 'purchasable' ||
		value === 'active' ||
		value === 'repair_required' ||
		value === 'confirmation_pending' ||
		value === 'checkout_disabled'
	);
}

/**
 * Server-reported eligibility passes through when present; deployments
 * predating the field return null and callers fall back to the released tier
 * heuristic (see effectiveCheckoutEligibility).
 */
export function resolveCheckoutEligibility(input: {
	checkoutEligibility: unknown;
}): CheckoutEligibility | null {
	if (input.checkoutEligibility === undefined) return null;
	if (isCheckoutEligibility(input.checkoutEligibility)) return input.checkoutEligibility;
	return null;
}

export function createInitialPricingState(): PricingUiState {
	return {
		status: 'loading',
		tier: 'free',
		tierLabel: 'Free',
		billingManaged: false,
		checkoutEligibility: null,
		accessPhase: null,
		authenticated: false,
		userLabel: null,
		message: null,
		busy: true,
		pendingAttemptId: null
	};
}

export function withReadySession(
	state: PricingUiState,
	input: {
		authenticated: boolean;
		tier: SubscriptionTier;
		tierLabel: string;
		billingManaged: boolean;
		checkoutEligibility?: CheckoutEligibility;
		accessPhase?: AccessPhase;
		userLabel: string | null;
		message?: string | null;
	}
): PricingUiState {
	const checkoutEligibility =
		input.checkoutEligibility !== undefined
			? input.checkoutEligibility
			: input.tier !== 'free'
				? 'active'
				: 'purchasable';
	return {
		...state,
		status: 'idle',
		authenticated: input.authenticated,
		tier: input.tier,
		tierLabel: input.tierLabel,
		billingManaged: input.billingManaged,
		checkoutEligibility,
		accessPhase: input.accessPhase ?? null,
		userLabel: input.userLabel,
		message: input.message ?? null,
		busy: false,
		pendingAttemptId: null
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
		checkoutEligibility: 'active',
		accessPhase: null,
		message: `${tierLabel} is active. You can manage billing anytime from this page.`,
		busy: false,
		pendingAttemptId: null
	};
}

export function withConfirmationPending(
	state: PricingUiState,
	tierLabel: string,
	attemptId?: string | null
): PricingUiState {
	return {
		...state,
		status: 'idle',
		checkoutEligibility: 'confirmation_pending',
		pendingAttemptId: attemptId ?? state.pendingAttemptId,
		message: `We could not confirm your ${tierLabel} payment yet. Use "Check payment status" below to check again — no new purchase will be started.`,
		busy: false
	};
}

export function effectiveCheckoutEligibility(state: PricingUiState): CheckoutEligibility {
	return state.checkoutEligibility ?? (state.tier !== 'free' ? 'active' : 'purchasable');
}

export function canStartCheckout(state: PricingUiState): boolean {
	if (state.busy) return false;
	const eligibility = effectiveCheckoutEligibility(state);
	if (eligibility !== 'purchasable') return false;
	return state.checkoutEligibility !== null || state.tier === 'free';
}

export function showsManageBilling(state: PricingUiState): boolean {
	return state.authenticated && state.billingManaged;
}

export function showsRepairBilling(state: PricingUiState): boolean {
	return state.authenticated && effectiveCheckoutEligibility(state) === 'repair_required';
}
