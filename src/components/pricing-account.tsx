import { showsManageBilling, type PricingUiState } from '@/lib/pricing/checkout-state';
import { cn } from '@/utils';

const BILLING_SUPPORT_EMAIL = 'aarav@spikonado.com';

export type PricingAccountProps = {
	state: PricingUiState;
	onManageBilling: () => void;
	onCheckStatus: () => void;
	onContinueCheckout: () => void;
	onSignOut: () => void;
};

export function PricingAccount({
	state,
	onManageBilling,
	onCheckStatus,
	onContinueCheckout,
	onSignOut
}: PricingAccountProps) {
	const paidTier = state.tier !== 'free';
	const paymentPending = state.authenticated && state.pendingAttemptId !== null;
	return (
		<>
			{state.message ? (
				<p
					className={cn(
						'mt-6 max-w-2xl rounded-xl border px-4 py-3 text-left text-sm',
						state.status === 'error'
							? 'border-red-300/70 bg-red-50 text-red-900'
							: 'border-accent/25 bg-accent-soft text-foreground'
					)}
					role={state.status === 'error' ? 'alert' : 'status'}
					aria-live="polite"
				>
					{state.message}
				</p>
			) : null}
			{paymentPending ? (
				<div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm">
					<p className="w-full text-muted-foreground">
						Your payment is not confirmed yet. This can take a moment — your plan updates
						automatically once the payment is confirmed. If you are stuck, email{' '}
						<a
							className="font-medium text-accent-strong underline decoration-accent-strong/30 underline-offset-4"
							href={`mailto:${BILLING_SUPPORT_EMAIL}?subject=Sprocket%20billing%20support`}
						>
							{BILLING_SUPPORT_EMAIL}
						</a>
						.
					</p>
					{state.pendingCheckoutUrl ? (
						<button
							type="button"
							className="font-medium text-accent-strong underline decoration-accent-strong/30 underline-offset-4"
							disabled={state.busy}
							onClick={onContinueCheckout}
						>
							Continue checkout
						</button>
					) : null}
					<button
						type="button"
						className="font-medium text-accent-strong underline decoration-accent-strong/30 underline-offset-4"
						disabled={state.busy}
						onClick={onCheckStatus}
					>
						{state.status === 'activating' ? 'Checking…' : 'Check payment status'}
					</button>
				</div>
			) : null}
			{state.authenticated && state.userLabel ? (
				<div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
					<p>
						Signed in as <span className="text-foreground">{state.userLabel}</span>
						{paidTier ? (
							<>
								. Current plan: <span className="text-foreground">{state.tierLabel}</span>
							</>
						) : null}
					</p>
					<button
						type="button"
						className="font-medium text-accent-strong underline decoration-accent-strong/30 underline-offset-4"
						onClick={onSignOut}
					>
						Sign out
					</button>
				</div>
			) : null}
			{showsManageBilling(state) ? (
				<div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm">
					{!paidTier ? (
						<p className="w-full text-muted-foreground">
							No paid plan is active. View billing history or fix a failed payment in the billing
							portal.
						</p>
					) : null}
					<button
						type="button"
						className="font-medium text-accent-strong underline decoration-accent-strong/30 underline-offset-4"
						disabled={state.busy}
						onClick={onManageBilling}
					>
						{state.status === 'managing_billing' ? 'Opening billing portal...' : 'Manage billing'}
					</button>
					<a
						className="font-medium text-accent-strong underline decoration-accent-strong/30 underline-offset-4"
						href={`mailto:${BILLING_SUPPORT_EMAIL}?subject=Sprocket%20billing%20support`}
					>
						Billing support
					</a>
				</div>
			) : null}
		</>
	);
}
