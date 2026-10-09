import {
	createCheckout,
	initializePricingBilling,
	signInForPricing
} from '@/lib/pricing/billing-client';
import { isBillingInterval, type BillingInterval } from '@/lib/pricing/catalog';
import type { OperationGuard } from '@/lib/pricing/operation';
import { clearPendingPricingAction, storePendingPricingAction } from '@/lib/pricing/pending';

function accountIdFrom(user: { id?: unknown; email?: unknown } | null): string | null {
	if (!user) return null;
	const id = typeof user.id === 'string' ? user.id.trim() : '';
	if (id) return id;
	const email = typeof user.email === 'string' ? user.email.trim() : '';
	return email || null;
}

export type CheckoutProgressStatus = 'starting' | 'signing_in' | 'redirecting' | 'error';

export type CheckoutProgress = {
	status: CheckoutProgressStatus;
	message: string;
	tierId: string;
	interval: BillingInterval;
	attemptId?: string;
};

export type CheckoutRequest = {
	tierId: string;
	interval: BillingInterval;
};

export type RunCheckoutOptions = {
	guard: OperationGuard;
	emit: (progress: CheckoutProgress) => void;
	allowSignIn?: boolean;
};

const INIT_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

export function checkoutRequestFromSearch(
	search: string = typeof window === 'undefined' ? '' : window.location.search
): CheckoutRequest | null {
	const params = new URLSearchParams(search);
	if (params.get('checkout') !== 'start' && params.get('checkout') !== 'resume') return null;
	const requested = params.get('interval');
	const tierId = params.get('tier')?.trim();
	if (!tierId || !isBillingInterval(requested)) return null;
	return {
		tierId,
		interval: requested
	};
}

export function pricingUrlWithoutCheckoutCommand(url: string): string {
	const parsed = new URL(url, 'https://spikonado.com');
	parsed.searchParams.delete('checkout');
	parsed.searchParams.delete('interval');
	parsed.searchParams.delete('tier');
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export async function runCheckout(
	tierId: string,
	interval: BillingInterval,
	options: RunCheckoutOptions
): Promise<void> {
	const { guard } = options;
	const emit = (status: CheckoutProgressStatus, message: string, attemptId?: string) => {
		if (!guard.isCurrent()) return;
		const detail: CheckoutProgress = {
			status,
			message,
			tierId,
			interval,
			attemptId
		};
		options.emit(detail);
	};

	if (!guard.isCurrent()) return;
	let attemptId: string | undefined;

	try {
		storePendingPricingAction({ type: 'checkout', tierId, interval });
		emit('starting', 'Preparing secure checkout…');

		const client = await withTimeout(
			Promise.resolve().then(() => initializePricingBilling()),
			INIT_TIMEOUT_MS,
			'Could not reach billing. Check your connection and try again.'
		);
		guard.assertCurrent();

		if (!client.isConfigured) {
			emit('error', client.error ?? 'Checkout is not configured yet.');
			return;
		}
		const user = client.auth?.getUser() ?? null;
		if (!user) {
			if (options.allowSignIn === false) {
				throw new Error(
					'Your sign-in session could not be restored. Check the WorkOS session configuration and browser storage, then choose your plan to try again.'
				);
			}
			emit('signing_in', 'Redirecting to sign in…');
			await signInForPricing();
			guard.assertCurrent();
			return;
		}
		if (accountIdFrom(user) !== guard.context.accountId) {
			throw new Error('This billing action was cancelled.');
		}

		clearPendingPricingAction();
		emit('starting', 'Opening secure checkout…');

		const checkout = await createCheckout(
			tierId,
			interval,
			guard.context.accountId,
			guard.isCurrent
		);
		guard.assertCurrent();
		attemptId = checkout.attemptId;
		emit('redirecting', 'Redirecting to secure checkout…', attemptId);
		guard.assertCurrent();
		window.location.assign(checkout.checkoutUrl);
	} catch (error) {
		if (!guard.isCurrent()) return;
		emit('error', error instanceof Error ? error.message : 'Could not start checkout.', attemptId);
	}
}
