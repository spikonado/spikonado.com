import { DodoPayments, type CheckoutEvent } from 'dodopayments-checkout';

export type DodoCheckoutMode = 'test' | 'live';
export type DodoCheckoutEvent = CheckoutEvent;

let initialized = false;
let checkoutEventHandler: ((event: DodoCheckoutEvent) => void) | null = null;

function resolveCheckoutMode(): DodoCheckoutMode {
	const configured = import.meta.env.PUBLIC_DODO_CHECKOUT_MODE?.trim();
	return configured === 'live' ? 'live' : 'test';
}

export function ensureDodoCheckoutInitialized(onEvent?: (event: DodoCheckoutEvent) => void): void {
	checkoutEventHandler = onEvent ?? checkoutEventHandler;
	if (initialized || typeof window === 'undefined') return;
	DodoPayments.Initialize({
		mode: resolveCheckoutMode(),
		displayType: 'overlay',
		onEvent: (event) => {
			checkoutEventHandler?.(event);
		}
	});
	initialized = true;
}

/** Open overlay checkout; fall back to hosted redirect if overlay open fails. */
export async function openCheckoutUrl(
	checkoutUrl: string,
	onEvent?: (event: DodoCheckoutEvent) => void
): Promise<'overlay' | 'redirect'> {
	ensureDodoCheckoutInitialized(onEvent);
	try {
		DodoPayments.Checkout.open({ checkoutUrl });
		return 'overlay';
	} catch {
		window.location.assign(checkoutUrl);
		return 'redirect';
	}
}
