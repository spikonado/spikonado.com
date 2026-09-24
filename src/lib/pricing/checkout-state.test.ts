import { describe, expect, test } from 'bun:test';
import {
	canStartCheckout,
	createInitialPricingState,
	showsManageBilling,
	withActivatedTier,
	withActivationTimeout,
	withBusyStatus,
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

		const pending = withActivationTimeout(errored, 'Team');
		expect(pending.status).toBe('idle');
		expect(pending.message).toContain('Team activation is still confirming');

		expect(withReadyStatus(errored, 'Checkout closed')).toMatchObject({
			status: 'idle',
			message: 'Checkout closed',
			busy: false
		});
	});
});
