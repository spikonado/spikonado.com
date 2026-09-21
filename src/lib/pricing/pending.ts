import { isBillingInterval, type BillingInterval } from '@/lib/pricing/catalog';

const PENDING_KEY = 'spikonado_pricing_pending';

export type PendingPricingAction = { type: 'checkout'; interval: BillingInterval };

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
		const parsed = JSON.parse(raw) as PendingPricingAction | { type: 'start_free' };
		// Legacy start_free pending actions are ignored; Free CTA now links to /sprocket.
		if (parsed?.type === 'start_free') {
			clearPendingPricingAction();
			return null;
		}
		if (parsed?.type === 'checkout' && isBillingInterval(parsed.interval)) {
			return { type: 'checkout', interval: parsed.interval };
		}
	} catch {
		// Ignore corrupt session state.
	}
	clearPendingPricingAction();
	return null;
}
