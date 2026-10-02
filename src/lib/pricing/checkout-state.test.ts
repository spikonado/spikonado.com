import { describe, expect, test } from 'bun:test';
import {
	canStartCheckout,
	createInitialPricingState,
	showsManageBilling,
	withActivatedTier,
	withBusyStatus,
	withError,
	withPaymentPending,
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

	test('lapsed free users keep manage billing and can purchase again', () => {
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

	test('an active paid tier does not prohibit checkout locally once idle', () => {
		const state = withActivatedTier(
			withBusyStatus(createInitialPricingState(), 'activating', 'Confirming...'),
			'team',
			'Team'
		);
		expect(state).toMatchObject({ tier: 'team', tierLabel: 'Team' });
		expect(state.busy).toBe(false);
		// Duplicate protection lives at the provider (Allow Multiple Subscriptions
		// Off), not in local subscription-state gating.
		expect(canStartCheckout(state)).toBe(true);
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
		expect(showsManageBilling(state)).toBe(false);
	});

	test('busy states block a new selection regardless of tier', () => {
		const busy = withBusyStatus(createInitialPricingState(), 'starting_checkout', 'Starting...');
		expect(canStartCheckout(busy)).toBe(false);
	});

	test('tracks errors and payment-pending messages', () => {
		const errored = withError(createInitialPricingState(), 'Checkout failed');
		expect(errored).toMatchObject({ status: 'error', message: 'Checkout failed', busy: false });

		const pending = withPaymentPending(errored, 'Team', 'attempt-1', null);
		expect(pending.status).toBe('idle');
		expect(pending.message).toContain('could not confirm your Team payment');
		expect(pending.message).not.toContain('Payment received');
		expect(pending.pendingAttemptId).toBe('attempt-1');
		expect(pending.pendingCheckoutUrl).toBeNull();

		const resumable = withPaymentPending(
			errored,
			'Team',
			'attempt-1',
			'https://checkout.example/session/cks_a'
		);
		expect(resumable.pendingCheckoutUrl).toBe('https://checkout.example/session/cks_a');

		// A lookup that no longer reports a resumable URL clears any stale one.
		const settled = withPaymentPending(resumable, 'Team', 'attempt-1', null);
		expect(settled.pendingCheckoutUrl).toBeNull();

		expect(withReadyStatus(errored, 'Checkout closed')).toMatchObject({
			status: 'idle',
			message: 'Checkout closed',
			busy: false
		});
	});

	test('a ready session clears any pending attempt reference', () => {
		const pending = withPaymentPending(
			createInitialPricingState(),
			'Team',
			'attempt-1',
			'https://checkout.example/session/cks_a'
		);
		const ready = withReadySession(pending, {
			authenticated: true,
			tier: 'team',
			tierLabel: 'Team',
			billingManaged: true,
			userLabel: 'dev@example.com'
		});
		expect(ready.pendingAttemptId).toBeNull();
		expect(ready.pendingCheckoutUrl).toBeNull();
	});
});
