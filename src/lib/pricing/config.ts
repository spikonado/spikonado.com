export type DodoCheckoutMode = 'test' | 'live';

/**
 * The Dodo checkout overlay mode. Unset outside local development: production
 * billing must opt in explicitly instead of silently defaulting to test mode.
 * The backend enforces its own readiness; this only governs which overlay the
 * browser loads.
 */
export function resolveCheckoutMode(
	raw: string | undefined = import.meta.env.PUBLIC_DODO_CHECKOUT_MODE,
	hostname: string | null = typeof window === 'undefined' ? null : window.location.hostname
): DodoCheckoutMode {
	const configured = raw?.trim();
	if (configured === 'test' || configured === 'live') return configured;
	if (configured) {
		throw new Error(
			'PUBLIC_DODO_CHECKOUT_MODE must be "test" or "live". Fix the deployment environment.'
		);
	}
	if (hostname === 'localhost' || hostname === '127.0.0.1') return 'test';
	throw new Error(
		'Billing checkout is not configured (missing PUBLIC_DODO_CHECKOUT_MODE). Set it to the mode matching the billing backend.'
	);
}
