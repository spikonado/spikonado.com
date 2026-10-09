export type DodoCheckoutMode = 'test' | 'live';

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
