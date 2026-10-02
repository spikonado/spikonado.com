import {
	createCheckout,
	initializePricingBilling,
	signInForPricing
} from '@/lib/pricing/billing-client';
import { isBillingInterval, type BillingInterval } from '@/lib/pricing/catalog';
import type { CheckoutOverlay } from '@/lib/pricing/checkout-overlay';
import type { OperationGuard } from '@/lib/pricing/operation';
import { clearPendingPricingAction, storePendingPricingAction } from '@/lib/pricing/pending';

function accountIdFrom(user: { id?: unknown; email?: unknown } | null): string | null {
	if (!user) return null;
	const id = typeof user.id === 'string' ? user.id.trim() : '';
	if (id) return id;
	const email = typeof user.email === 'string' ? user.email.trim() : '';
	return email || null;
}

export const PRICING_CHECKOUT_PROGRESS_EVENT = 'spikonado:pricing-checkout-progress';

export type CheckoutProgressStatus =
	'starting' | 'signing_in' | 'checkout_open' | 'checkout_closed' | 'error';

export type CheckoutProgress = {
	status: CheckoutProgressStatus;
	message: string;
	tierId: string;
	interval: BillingInterval;
	generation: number;
	accountId: string | null;
	attemptId?: string;
};

export type CheckoutRequest = {
	tierId: string;
	interval: BillingInterval;
};

export type RunCheckoutOptions = {
	overlay: CheckoutOverlay;
	guard: OperationGuard;
	attemptId?: string;
	emit?: (progress: CheckoutProgress) => void;
};

const INIT_TIMEOUT_MS = 12_000;

export function emitCheckoutProgress(detail: CheckoutProgress): void {
	if (typeof document === 'undefined') return;
	document.dispatchEvent(
		new CustomEvent<CheckoutProgress>(PRICING_CHECKOUT_PROGRESS_EVENT, { detail })
	);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

export function checkoutRequestFromSearch(
	search: string = typeof window === 'undefined' ? '' : window.location.search
): CheckoutRequest | null {
	const params = new URLSearchParams(search);
	if (params.get('checkout') !== 'start') return null;
	const requested = params.get('interval');
	const tierId = params.get('tier')?.trim();
	if (!tierId || !isBillingInterval(requested)) return null;
	return {
		tierId,
		interval: requested
	};
}

export function pricingUrlWithoutCheckoutCommand(url: string): string {
	const parsed = new URL(url, 'https://spikonado.com');
	parsed.searchParams.delete('checkout');
	parsed.searchParams.delete('interval');
	parsed.searchParams.delete('tier');
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Runs one checkout attempt bound to the operation guard's account and
 * generation. The guard is checked after every awaited step and before any
 * URL is opened or progress reported, so a superseded operation (sign-out,
 * account switch, unmount, newer click) can neither open a link nor emit into
 * the current UI. Never resolves another caller's operation; the server
 * serializes attempts per account.
 */
export async function runCheckout(
	tierId: string,
	interval: BillingInterval,
	options: RunCheckoutOptions
): Promise<void> {
	const { overlay, guard } = options;
	const emit = (status: CheckoutProgressStatus, message: string, attemptId?: string) => {
		if (!guard.isCurrent()) return;
		const detail: CheckoutProgress = {
			status,
			message,
			tierId,
			interval,
			generation: guard.context.generation,
			accountId: guard.context.accountId,
			attemptId
		};
		if (options.emit) options.emit(detail);
		else emitCheckoutProgress(detail);
	};

	// Account guard before the first await: the guard must still be current
	// before we touch storage or emit progress.
	if (!guard.isCurrent()) return;
	storePendingPricingAction({ type: 'checkout', tierId, interval });
	emit('starting', 'Preparing secure checkout…');

	try {
		const client = await withTimeout(
			Promise.resolve().then(() => initializePricingBilling()),
			INIT_TIMEOUT_MS,
			'Could not reach billing. Check your connection and try again.'
		);
		guard.assertCurrent();

		if (!client.isConfigured) {
			emit('error', client.error ?? 'Checkout is not configured yet.');
			return;
		}
		const user = client.auth?.getUser() ?? null;
		if (!user) {
			emit('signing_in', 'Redirecting to sign in…');
			await signInForPricing();
			// The account may have changed while the sign-in redirect was in flight.
			guard.assertCurrent();
			return;
		}
		if (accountIdFrom(user) !== guard.context.accountId) {
			throw new Error('This billing action was cancelled.');
		}

		clearPendingPricingAction();
		emit('starting', 'Opening secure checkout…');

		const checkout = await createCheckout(tierId, interval, guard.context.accountId);
		guard.assertCurrent();

		emit('checkout_open', 'Complete checkout in the overlay…', checkout.attemptId);
		// An SDK checkout.error is not an authoritative payment failure: the
		// attempt reference is already persisted, so the close path still offers
		// status checks and same-link resume. Each error surfaces once.
		let sdkErrorReported = false;
		overlay.open(checkout.checkoutUrl, (event) => {
			if (!guard.isCurrent()) return;
			if (event.event_type === 'checkout.closed') {
				emit(
					'checkout_closed',
					sdkErrorReported
						? 'Checkout closed after a problem. You can check the payment status or continue the same checkout from this page.'
						: 'Checkout closed. You can try again anytime.',
					checkout.attemptId
				);
			} else if (event.event_type === 'checkout.error') {
				sdkErrorReported = true;
				emit(
					'error',
					'Checkout hit a problem before closing. If you paid, your plan will activate shortly — check the payment status instead of starting a new purchase.',
					checkout.attemptId
				);
			}
		});
	} catch (error) {
		if (!guard.isCurrent()) return;
		emit('error', error instanceof Error ? error.message : 'Could not start checkout.');
	}
}
