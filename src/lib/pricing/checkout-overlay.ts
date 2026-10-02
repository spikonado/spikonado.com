import { DodoPayments, type CheckoutEvent } from 'dodopayments-checkout';
import { resolveCheckoutMode } from '@/lib/pricing/config';

export type DodoCheckoutEvent = CheckoutEvent;

export type CheckoutOverlay = {
	open(checkoutUrl: string, onEvent?: (event: DodoCheckoutEvent) => void): 'overlay' | 'redirect';
	close(): void;
};

/**
 * One overlay per caller. The Dodo SDK is a page-wide singleton whose global
 * message listener is registered once at Initialize and kept alive after
 * close(). Each instance guards dispatch with a generation token captured at
 * open(): only the latest open on this instance receives events, and a closed
 * or superseded instance dispatches nothing, so a stale handler can never fire
 * into a new account's UI.
 */
export function createCheckoutOverlay(): CheckoutOverlay {
	let initialized = false;
	let handler: ((event: DodoCheckoutEvent) => void) | null = null;
	let active = false;

	function ensureInitialized(): void {
		if (initialized || typeof window === 'undefined') return;
		DodoPayments.Initialize({
			mode: resolveCheckoutMode(),
			displayType: 'overlay',
			onEvent: (event) => {
				if (active) handler?.(event);
			}
		});
		initialized = true;
	}

	return {
		open(
			checkoutUrl: string,
			eventHandler?: (event: DodoCheckoutEvent) => void
		): 'overlay' | 'redirect' {
			// A new open supersedes any previous handler before touching the SDK.
			active = false;
			handler = null;
			ensureInitialized();
			try {
				DodoPayments.Checkout.open({ checkoutUrl });
			} catch {
				window.location.assign(checkoutUrl);
				return 'redirect';
			}
			active = true;
			handler = eventHandler ?? null;
			return 'overlay';
		},
		close(): void {
			active = false;
			handler = null;
			try {
				if (initialized) DodoPayments.Checkout.close();
			} catch {
				// The overlay may already be gone; closing must never throw.
			}
		}
	};
}
