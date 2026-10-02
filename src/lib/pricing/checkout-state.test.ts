import { describe, expect, test } from 'bun:test';
import {
	canStartCheckout,
	createInitialPricingState,
	effectiveCheckoutEligibility,
	isCheckoutEligibility,
	showsManageBilling,
	showsRepairBilling,
	withActivatedTier,
	withBusyStatus,
	withConfirmationPending,
	withError,
	withReadySession,
	withReadyStatus
} from './checkout-state.ts';

describe('pricing checkout state', () => {
	test('starts loading and busy', () => {
		const state = createInitialPricingState();
		expect(state).toMatchObject({
			status: 'loading',
			tier: 'free',
			busy: true
		});
		expect(canStartCheckout(state)).toBe(false);
	});

	test('allows checkout for free signed-in users when idle', () => {
		const state = withReadySession(createInitialPricingState(), {
			authenticated: true,
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: false,
			userLabel: 'dev@example.com'
		});
		expect(canStartCheckout(state)).toBe(true);
		expect(showsManageBilling(state)).toBe(false);
	});

	test('lapsed free users keep manage billing and purchase eligibility', () => {
		const state = withReadySession(createInitialPricingState(), {
			authenticated: true,
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: true,
			userLabel: 'dev@example.com'
		});
		expect(canStartCheckout(state)).toBe(true);
		expect(showsManageBilling(state)).toBe(true);
	});

	test('shows manage billing for an active paid tier and blocks duplicate checkout', () => {
		const state = withActivatedTier(
			withBusyStatus(createInitialPricingState(), 'activating', 'Confirming...'),
			'team',
			'Team'
		);
		expect(state).toMatchObject({ tier: 'team', tierLabel: 'Team' });
		expect(state.busy).toBe(false);
		expect(canStartCheckout(state)).toBe(false);
		expect(showsManageBilling(state)).toBe(true);
	});

	test('does not offer Dodo actions for operator-managed tiers', () => {
		const state = withReadySession(createInitialPricingState(), {
			authenticated: true,
			tier: 'max',
			tierLabel: 'Max',
			billingManaged: false,
			userLabel: 'dev@example.com'
		});
		expect(canStartCheckout(state)).toBe(false);
		expect(showsManageBilling(state)).toBe(false);
	});

	test('tracks errors and activation timeout messages', () => {
		const errored = withError(createInitialPricingState(), 'Checkout failed');
		expect(errored).toMatchObject({ status: 'error', message: 'Checkout failed', busy: false });

		const pending = withConfirmationPending(errored, 'Team');
		expect(pending.status).toBe('idle');
		expect(pending.message).toContain('could not confirm your Team payment');
		expect(pending.message).not.toContain('Payment received');
		expect(pending.checkoutEligibility).toBe('confirmation_pending');
		const purchasable = withReadySession(createInitialPricingState(), {
			authenticated: true,
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: false,
			checkoutEligibility: 'purchasable',
			userLabel: 'dev@example.com'
		});
		expect(canStartCheckout(withConfirmationPending(purchasable, 'Team', 'pending'))).toBe(false);

		expect(withReadyStatus(errored, 'Checkout closed')).toMatchObject({
			status: 'idle',
			message: 'Checkout closed',
			busy: false
		});
	});

	test('server eligibility gates checkout independently of tier', () => {
		const pending = withReadySession(createInitialPricingState(), {
			authenticated: true,
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: true,
			checkoutEligibility: 'confirmation_pending',
			userLabel: 'dev@example.com'
		});
		expect(canStartCheckout(pending)).toBe(false);

		const repair = withReadySession(createInitialPricingState(), {
			authenticated: true,
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: true,
			checkoutEligibility: 'repair_required',
			userLabel: 'dev@example.com'
		});
		expect(canStartCheckout(repair)).toBe(false);
		expect(showsRepairBilling(repair)).toBe(true);
		expect(showsManageBilling(repair)).toBe(true);

		const disabled = withReadySession(createInitialPricingState(), {
			authenticated: true,
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: true,
			checkoutEligibility: 'checkout_disabled',
			userLabel: 'dev@example.com'
		});
		expect(canStartCheckout(disabled)).toBe(false);

		const purchasable = withReadySession(createInitialPricingState(), {
			authenticated: true,
			tier: 'team',
			tierLabel: 'Team',
			billingManaged: true,
			checkoutEligibility: 'purchasable',
			userLabel: 'dev@example.com'
		});
		expect(canStartCheckout(purchasable)).toBe(true);
	});

	test('validates server eligibility values and falls back without them', () => {
		expect(isCheckoutEligibility('purchasable')).toBe(true);
		expect(isCheckoutEligibility('confirmation_pending')).toBe(true);
		expect(isCheckoutEligibility('blocked')).toBe(false);
		expect(isCheckoutEligibility(undefined)).toBe(false);

		const legacy = withReadySession(createInitialPricingState(), {
			authenticated: true,
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: false,
			userLabel: null
		});
		expect(effectiveCheckoutEligibility(legacy)).toBe('purchasable');

		const legacyPaid = withActivatedTier(
			withBusyStatus(createInitialPricingState(), 'activating', null),
			'team',
			'Team'
		);
		expect(effectiveCheckoutEligibility(legacyPaid)).toBe('active');
	});
});
