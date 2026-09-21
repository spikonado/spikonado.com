import {
	createProCheckout,
	initializePricingBilling,
	signInForPricing
} from '@/lib/pricing/billing-client';
import { isBillingInterval, type BillingInterval } from '@/lib/pricing/catalog';
import { openCheckoutUrl } from '@/lib/pricing/checkout-overlay';
import { clearPendingPricingAction, storePendingPricingAction } from '@/lib/pricing/pending';

export const PRICING_CHECKOUT_PROGRESS_EVENT = 'spikonado:pricing-checkout-progress';

export type CheckoutProgressStatus =
	'starting' | 'signing_in' | 'checkout_open' | 'checkout_closed' | 'error';

export type CheckoutProgress = {
	status: CheckoutProgressStatus;
	message: string;
	interval: BillingInterval;
};

const INIT_TIMEOUT_MS = 12_000;

let inFlight: Promise<void> | null = null;

function emit(detail: CheckoutProgress): void {
	if (typeof document === 'undefined') return;
	document.dispatchEvent(
		new CustomEvent<CheckoutProgress>(PRICING_CHECKOUT_PROGRESS_EVENT, { detail })
	);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				window.clearTimeout(timer);
				reject(error);
			}
		);
	});
}

/** Read a Get Pro deep link like `/pricing?checkout=start&interval=monthly`. */
export function checkoutIntervalFromSearch(
	search: string = typeof window === 'undefined' ? '' : window.location.search
): BillingInterval | null {
	const params = new URLSearchParams(search);
	if (params.get('checkout') !== 'start') return null;
	const requested = params.get('interval');
	return isBillingInterval(requested) ? requested : 'monthly';
}

export function pricingUrlWithoutCheckoutCommand(url: string): string {
	const parsed = new URL(url, 'https://spikonado.com');
	parsed.searchParams.delete('checkout');
	parsed.searchParams.delete('interval');
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function runProCheckout(interval: BillingInterval): Promise<void> {
	if (inFlight) return inFlight;

	inFlight = (async () => {
		storePendingPricingAction({ type: 'checkout', interval });
		emit({ status: 'starting', message: 'Preparing secure checkout…', interval });
		try {
			const client = await withTimeout(
				initializePricingBilling(),
				INIT_TIMEOUT_MS,
				'Could not reach billing. Check your connection and try again.'
			);
			if (!client.isConfigured) {
				emit({
					status: 'error',
					message: client.error ?? 'Checkout is not configured yet.',
					interval
				});
				return;
			}
			if (!client.user) {
				emit({ status: 'signing_in', message: 'Redirecting to sign in…', interval });
				await signInForPricing();
				return;
			}
			clearPendingPricingAction();
			emit({ status: 'starting', message: 'Opening secure checkout…', interval });
			const checkoutUrl = await createProCheckout(interval);
			emit({
				status: 'checkout_open',
				message: 'Complete checkout in the overlay…',
				interval
			});
			let checkoutFailed = false;
			await openCheckoutUrl(checkoutUrl, (event) => {
				if (event.event_type === 'checkout.closed') {
					if (checkoutFailed) return;
					emit({
						status: 'checkout_closed',
						message: 'Checkout closed. You can try again anytime.',
						interval
					});
				} else if (event.event_type === 'checkout.error') {
					checkoutFailed = true;
					emit({ status: 'error', message: 'Checkout could not be completed.', interval });
				}
			});
		} catch (error) {
			emit({
				status: 'error',
				message: error instanceof Error ? error.message : 'Could not start checkout.',
				interval
			});
		} finally {
			inFlight = null;
		}
	})();

	return inFlight;
}

/** Start a checkout encoded in the pricing page URL. */
export function bootCheckoutFromUrl(search?: string): Promise<void> | null {
	const interval = checkoutIntervalFromSearch(
		search ?? (typeof window === 'undefined' ? '' : window.location.search)
	);
	if (!interval) return null;
	if (search === undefined && typeof window !== 'undefined') {
		window.history.replaceState(
			window.history.state,
			'',
			pricingUrlWithoutCheckoutCommand(window.location.href)
		);
	}
	return runProCheckout(interval);
}
