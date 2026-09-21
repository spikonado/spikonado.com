import { describe, expect, test } from 'bun:test';
import {
	canStartCheckout,
	createInitialPricingState,
	showsManageBilling,
	withActivatedPro,
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
			billingManaged: false,
			userLabel: 'dev@example.com'
		});
		expect(canStartCheckout(state)).toBe(true);
		expect(showsManageBilling(state)).toBe(false);
	});

	test('shows manage billing for pro and blocks duplicate checkout', () => {
		const state = withActivatedPro(
			withBusyStatus(createInitialPricingState(), 'activating', 'Confirming…')
		);
		expect(state.tier).toBe('pro');
		expect(state.busy).toBe(false);
		expect(canStartCheckout(state)).toBe(false);
		expect(showsManageBilling(state)).toBe(true);
	});

	test('does not offer Dodo actions for operator-managed tiers', () => {
		const state = withReadySession(createInitialPricingState(), {
			authenticated: true,
			tier: 'max',
			billingManaged: false,
			userLabel: 'dev@example.com'
		});
		expect(canStartCheckout(state)).toBe(false);
		expect(showsManageBilling(state)).toBe(false);
	});

	test('tracks errors and activation timeout messages', () => {
		const errored = withError(createInitialPricingState(), 'Checkout failed');
		expect(errored).toMatchObject({ status: 'error', message: 'Checkout failed', busy: false });

		const pending = withActivationTimeout(errored);
		expect(pending.status).toBe('idle');
		expect(pending.message).toContain('activation is still confirming');

		expect(withReadyStatus(errored, 'Checkout closed')).toMatchObject({
			status: 'idle',
			message: 'Checkout closed',
			busy: false
		});
	});
});
