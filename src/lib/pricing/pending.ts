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
};

function readJson(key: string): Record<string, unknown> | null {
	try {
		const raw = globalThis.sessionStorage?.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
	} catch {
		clearStoredValue(key);
		return null;
	}
	clearStoredValue(key);
	return null;
}

function storeJson(key: string, value: unknown): void {
	try {
		globalThis.sessionStorage.setItem(key, JSON.stringify(value));
	} catch {
		throw new Error(
			'Browser storage is unavailable. Enable site storage before starting checkout.'
		);
	}
}

function clearStoredValue(key: string): void {
	try {
		globalThis.sessionStorage?.removeItem(key);
	} catch {
		return;
	}
}

export function storePendingPricingAction(action: PendingPricingAction): void {
	storeJson(PENDING_KEY, action);
}

export function clearPendingPricingAction(): void {
	clearStoredValue(PENDING_KEY);
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
	const userId = accountId.trim();
	if (!userId || !attempt.attemptId.trim()) return;
	storeJson(ATTEMPT_KEY, { userId, ...attempt });
}

export function readCheckoutAttempt(accountId: string | null): PendingCheckoutAttempt | null {
	if (!accountId?.trim()) return null;
	const parsed = readJson(ATTEMPT_KEY);
	if (!parsed) return null;
	const interval = typeof parsed.interval === 'string' ? parsed.interval : null;
	const attemptId = typeof parsed.attemptId === 'string' ? parsed.attemptId.trim() : '';
	const tierId = typeof parsed.tierId === 'string' ? parsed.tierId.trim() : '';
	if (parsed.userId !== accountId || !attemptId || !tierId || !isBillingInterval(interval)) {
		return null;
	}
	return { attemptId, tierId, interval };
}

export function clearCheckoutAttempt(): void {
	clearStoredValue(ATTEMPT_KEY);
}
