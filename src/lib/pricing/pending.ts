import { isBillingInterval, type BillingInterval } from '@/lib/pricing/catalog';

const PENDING_KEY = 'spikonado_pricing_pending';
const ATTEMPT_KEY = 'spikonado_pricing_attempt';

export type PendingPricingAction = {
	type: 'checkout';
	tierId: string;
	interval: BillingInterval;
};

export type PendingCheckoutAttempt = {
	attemptId: string;
	tierId: string;
	interval: BillingInterval;
	startedAt: number;
};

function readJson(key: string): Record<string, unknown> | null {
	if (typeof sessionStorage === 'undefined') return null;
	const raw = sessionStorage.getItem(key);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
	} catch {
		// Corrupt session state is cleared below.
	}
	sessionStorage.removeItem(key);
	return null;
}

export function storePendingPricingAction(action: PendingPricingAction): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.setItem(PENDING_KEY, JSON.stringify(action));
}

export function clearPendingPricingAction(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(PENDING_KEY);
}

export function readPendingPricingAction(): PendingPricingAction | null {
	const parsed = readJson(PENDING_KEY);
	if (!parsed) return null;
	const interval = typeof parsed.interval === 'string' ? parsed.interval : null;
	if (parsed.type !== 'checkout' || !isBillingInterval(interval)) {
		clearPendingPricingAction();
		return null;
	}
	const tierId = typeof parsed.tierId === 'string' ? parsed.tierId.trim() : '';
	if (!tierId) {
		clearPendingPricingAction();
		return null;
	}
	return { type: 'checkout', tierId, interval };
}

/**
 * Account-bound checkout attempt reference used for reload/return recovery.
 * The attempt ID is opaque and only authorizes status lookups for the account
 * that created it; it never proves payment by itself.
 */
export function storeCheckoutAttempt(accountId: string, attempt: PendingCheckoutAttempt): void {
	if (typeof sessionStorage === 'undefined') return;
	const userId = accountId.trim();
	if (!userId || !attempt.attemptId.trim()) return;
	sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ userId, ...attempt }));
}

export function readCheckoutAttempt(accountId: string | null): PendingCheckoutAttempt | null {
	if (!accountId?.trim()) return null;
	const parsed = readJson(ATTEMPT_KEY);
	if (!parsed) return null;
	const interval = typeof parsed.interval === 'string' ? parsed.interval : null;
	const attemptId = typeof parsed.attemptId === 'string' ? parsed.attemptId.trim() : '';
	const tierId = typeof parsed.tierId === 'string' ? parsed.tierId.trim() : '';
	const startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : NaN;
	if (
		parsed.userId !== accountId ||
		!attemptId ||
		!tierId ||
		!isBillingInterval(interval) ||
		!Number.isFinite(startedAt)
	) {
		return null;
	}
	return { attemptId, tierId, interval, startedAt };
}

export function clearCheckoutAttempt(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(ATTEMPT_KEY);
}
