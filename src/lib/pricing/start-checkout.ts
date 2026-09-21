import {
	createProCheckout,
	initializePricingBilling,
	signInForPricing
} from '@/lib/pricing/billing-client';
import { isBillingInterval, type BillingInterval } from '@/lib/pricing/catalog';
import { openCheckoutUrl } from '@/lib/pricing/checkout-overlay';
import { clearPendingPricingAction, storePendingPricingAction } from '@/lib/pricing/pending';

export const PRICING_CHECKOUT_PROGRESS_EVENT = 'spikonado:pricing-checkout-progress';

export type CheckoutProgressStatus = 'starting' | 'signing_in' | 'checkout_open' | 'error';

export type CheckoutProgress = {
	status: CheckoutProgressStatus;
	message: string;
	interval: BillingInterval;
};

const INIT_TIMEOUT_MS = 12_000;
const BOOT_STATUS_ID = 'pricing-checkout-boot-status';

let inFlight: Promise<void> | null = null;
let clickHandlerInstalled = false;

function emit(detail: CheckoutProgress): void {
	if (typeof document === 'undefined') return;
	const status = document.getElementById(BOOT_STATUS_ID);
	if (status) {
		status.classList.remove('hidden');
		status.textContent = detail.message;
		status.setAttribute('role', detail.status === 'error' ? 'alert' : 'status');
	}
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

export function intervalFromCheckoutHref(href: string): BillingInterval {
	try {
		return checkoutIntervalFromSearch(new URL(href, 'https://spikonado.local').search) ?? 'monthly';
	} catch {
		return 'monthly';
	}
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
			await openCheckoutUrl(checkoutUrl);
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

/** Always-on boot for `/pricing?checkout=start` — does not wait for the Svelte island. */
export function bootCheckoutFromUrl(
	search: string = typeof window === 'undefined' ? '' : window.location.search
): Promise<void> | null {
	const interval = checkoutIntervalFromSearch(search);
	if (!interval) return null;
	return runProCheckout(interval);
}

function isModifiedClick(event: MouseEvent): boolean {
	return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function onGetProClick(event: Event): void {
	if (!(event instanceof MouseEvent) || event.defaultPrevented || isModifiedClick(event)) return;
	const target = event.target;
	if (!(target instanceof Element)) return;
	const link = target.closest('a[data-pricing-checkout]');
	if (!(link instanceof HTMLAnchorElement)) return;
	if (link.getAttribute('aria-disabled') === 'true') {
		event.preventDefault();
		return;
	}
	event.preventDefault();
	void runProCheckout(intervalFromCheckoutHref(link.href));
}

/** Intercept Get Pro clicks and resume `/pricing?checkout=start` without waiting on the island. */
export function installPricingCheckout(): void {
	if (typeof document === 'undefined') return;
	if (!clickHandlerInstalled) {
		clickHandlerInstalled = true;
		document.addEventListener('click', onGetProClick, true);
	}
	void bootCheckoutFromUrl();
}

export function resetCheckoutRunnerForTests(): void {
	inFlight = null;
	clickHandlerInstalled = false;
}
