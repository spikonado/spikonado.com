import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	createInitialPricingState,
	withActivatedTier,
	withBusyStatus,
	withPaymentPending,
	withReadySession,
	type PricingUiState
} from '@/lib/pricing/checkout-state';
import { PricingAccount } from './pricing-account.tsx';

function render(state: PricingUiState): string {
	return renderToStaticMarkup(
		createElement(PricingAccount, {
			state,
			onManageBilling: () => {},
			onCheckStatus: () => {},
			onContinueCheckout: () => {},
			onSignOut: () => {}
		})
	);
}

function lapsedFreeState(): PricingUiState {
	return withReadySession(createInitialPricingState(), {
		authenticated: true,
		tier: 'free',
		tierLabel: 'Free',
		billingManaged: true,
		userLabel: 'dev@example.com'
	});
}

describe('pricing account section', () => {
	test('offers manage billing to lapsed free users with managed billing', () => {
		const markup = render(lapsedFreeState());
		expect(markup).toContain('Manage billing');
		expect(markup).toContain('View billing history or fix a failed payment');
		expect(markup).toContain('Signed in as');
		expect(markup).not.toContain('disabled');
	});

	test('hides manage billing for free users without a Dodo customer', () => {
		const state = withReadySession(createInitialPricingState(), {
			authenticated: true,
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: false,
			userLabel: 'dev@example.com'
		});
		const markup = render(state);
		expect(markup).not.toContain('Manage billing');
		expect(markup).toContain('dev@example.com');
	});

	test('hides manage billing for signed-out visitors', () => {
		const state = withReadySession(createInitialPricingState(), {
			authenticated: false,
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: false,
			userLabel: null
		});
		const markup = render(state);
		expect(markup).not.toContain('Manage billing');
		expect(markup).not.toContain('Signed in as');
	});

	test('shows the active paid plan and manage billing without lapsed copy', () => {
		const state = withActivatedTier(
			withBusyStatus(lapsedFreeState(), 'activating', 'Confirming...'),
			'team',
			'Team'
		);
		const markup = render(state);
		expect(markup).toContain('Manage billing');
		expect(markup).toContain('Current plan: <span class="text-foreground">Team</span>');
		expect(markup).not.toContain('fix a failed payment');
	});

	test('disables manage billing while the portal is opening', () => {
		const state = withBusyStatus(lapsedFreeState(), 'managing_billing', 'Opening...');
		const markup = render(state);
		expect(markup).toContain('Opening billing portal...');
		expect(markup).toContain('disabled');
	});

	test('a pending attempt without a resumable URL offers status checking and support', () => {
		const state = withPaymentPending(lapsedFreeState(), 'Team', 'attempt-1', null);
		const markup = render(state);
		expect(markup).toContain('Check payment status');
		expect(markup).toContain('not confirmed yet');
		expect(markup).toContain('aarav@spikonado.com');
		expect(markup).not.toContain('Continue checkout');
		expect(markup).not.toContain('Payment received');
	});

	test('a pending attempt with a resumable URL offers continue checkout', () => {
		const state = withPaymentPending(
			lapsedFreeState(),
			'Team',
			'attempt-1',
			'https://checkout.example/session/cks_a'
		);
		const markup = render(state);
		expect(markup).toContain('Continue checkout');
		expect(markup).toContain('Check payment status');
	});

	test('signed-out visitors never see pending recovery actions', () => {
		const signedOut = withReadySession(createInitialPricingState(), {
			authenticated: false,
			tier: 'free',
			tierLabel: 'Free',
			billingManaged: false,
			userLabel: null
		});
		const markup = render(signedOut);
		expect(markup).not.toContain('Check payment status');
		expect(markup).not.toContain('Continue checkout');
	});
});
