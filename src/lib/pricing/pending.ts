import { isBillingInterval, type BillingInterval } from '@/lib/pricing/catalog';

const PENDING_KEY = 'spikonado_pricing_pending';

export type PendingPricingAction = {
	type: 'checkout';
	tierId: string;
	interval: BillingInterval;
};

export function storePendingPricingAction(action: PendingPricingAction): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.setItem(PENDING_KEY, JSON.stringify(action));
}

export function clearPendingPricingAction(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(PENDING_KEY);
}

export function readPendingPricingAction(): PendingPricingAction | null {
	if (typeof sessionStorage === 'undefined') return null;
	const raw = sessionStorage.getItem(PENDING_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as {
			type?: unknown;
			tierId?: unknown;
			interval?: unknown;
		};
		const interval = typeof parsed.interval === 'string' ? parsed.interval : null;
		if (parsed?.type === 'checkout' && isBillingInterval(interval)) {
			const tierId = typeof parsed.tierId === 'string' ? parsed.tierId.trim() : '';
			if (tierId) return { type: 'checkout', tierId, interval };
		}
	} catch {
		// Ignore corrupt session state.
	}
	clearPendingPricingAction();
	return null;
}
