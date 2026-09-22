import { useCallback, useEffect, useMemo, useState } from 'react';
import { PricingTableOne } from '@/components/billingsdk/pricing-table-one';
import { captureAnalyticsEvent } from '@/lib/analytics/bootstrap';
import {
	CHECKOUT_STARTED_EVENT,
	CHECKOUT_STATUS_EVENT,
	CTA_CLICKED_EVENT,
	INTERVAL_SELECTED_EVENT,
	type AnalyticsLocation
} from '@/lib/analytics/events';
import type { BillingPlan } from '@/lib/billingsdk-config';
import {
	fetchMySubscription,
	fetchPublicPricingCatalog,
	initializePricingBilling,
	openCustomerPortal,
	signOutOfPricing,
	type PublicPricingCatalog,
	type SubscriptionTier
} from '@/lib/pricing/billing-client';
import {
	buildPricingPlans,
	priceLabel,
	pricingFaqs,
	pricesForPlan,
	type BillingInterval
} from '@/lib/pricing/catalog';
import {
	createInitialPricingState,
	canStartCheckout,
	showsManageBilling,
	withActivatedTier,
	withActivationTimeout,
	withBusyStatus,
	withError,
	withReadySession,
	withReadyStatus,
	type PricingUiState
} from '@/lib/pricing/checkout-state';
import {
	checkoutRequestFromSearch,
	pricingUrlWithoutCheckoutCommand,
	PRICING_CHECKOUT_PROGRESS_EVENT,
	runCheckout,
	type CheckoutProgress
} from '@/lib/pricing/start-checkout';
import { cn } from '@/utils';

interface PricingPlansProps {
	initialCatalog?: PublicPricingCatalog | null;
}

const location: AnalyticsLocation = 'pricing_page';
const ACTIVATION_TIMEOUT_MS = 30_000;
const ACTIVATION_POLL_MS = 2_000;

function currencySymbol(currency: string): string {
	try {
		return (
			new Intl.NumberFormat('en-US', {
				style: 'currency',
				currency,
				currencyDisplay: 'narrowSymbol',
				maximumFractionDigits: 0
			})
				.formatToParts(0)
				.find((part) => part.type === 'currency')?.value ?? `${currency} `
		);
	} catch {
		return `${currency} `;
	}
}

function planPrice(planId: string, price: number | undefined): string {
	if (planId === 'free') return '0';
	return price === undefined ? 'Unavailable' : String(price);
}

function billingPlans(catalog: PublicPricingCatalog): BillingPlan[] {
	const plans = buildPricingPlans(catalog);

	return plans.map((plan) => {
		const source = catalog.plans.find((candidate) => candidate.id === plan.id);
		if (!source) throw new Error(`Pricing plan "${plan.id}" is missing from the catalog.`);
		const prices = pricesForPlan(source, catalog);
		const monthly = priceLabel('monthly', prices);
		const annual = priceLabel('annual', prices);
		return {
			id: plan.id,
			title: plan.name,
			description: plan.description,
			highlight: plan.highlighted,
			badge: plan.highlighted ? 'Most popular' : undefined,
			currency: currencySymbol(monthly?.currency ?? annual?.currency ?? 'USD'),
			monthlyPrice: planPrice(plan.id, monthly?.periodMajor),
			yearlyPrice: planPrice(plan.id, annual?.periodMajor),
			buttonText: plan.id === 'free' ? 'Start free' : `Get ${plan.name}`,
			features: plan.features.map((feature) => ({ name: feature, icon: 'check' }))
		};
	});
}

function planIsAvailable(
	catalog: PublicPricingCatalog | null,
	planId: string,
	interval: BillingInterval
): boolean {
	if (!catalog) return false;
	const plan = catalog.plans.find((candidate) => candidate.id === planId);
	return Boolean(plan && pricesForPlan(plan, catalog)[interval]);
}

function isPaidTier(tier: SubscriptionTier): boolean {
	return tier !== 'free';
}

export default function PricingPlans({ initialCatalog = null }: PricingPlansProps) {
	const [state, setState] = useState<PricingUiState>(() => createInitialPricingState());
	const [interval, setInterval] = useState<BillingInterval>('monthly');
	const [catalog, setCatalog] = useState<PublicPricingCatalog | null>(initialCatalog);
	const [checkoutTierId, setCheckoutTierId] = useState<string | null>(null);
	const plans = useMemo(() => (catalog ? billingPlans(catalog) : []), [catalog]);
	const checkoutInFlight = state.busy;

	const refreshSession = useCallback(async (message: string | null = null) => {
		const client = await initializePricingBilling();
		let tier: SubscriptionTier = 'free';
		let tierLabel = 'Free';
		let billingManaged = false;
		if (client.user) {
			const subscription = await fetchMySubscription();
			tier = subscription.tier;
			tierLabel = subscription.tierLabel;
			billingManaged = subscription.billingManaged;
		}
		setState((current) =>
			withReadySession(current, {
				authenticated: Boolean(client.user),
				tier,
				tierLabel,
				billingManaged,
				userLabel: client.user?.email ?? client.user?.firstName ?? null,
				message
			})
		);
	}, []);

	const waitForTierActivation = useCallback(
		async (tierId: string, tierLabel: string, showPendingState = true) => {
			const client = showPendingState ? null : await initializePricingBilling();
			let sessionReconciled = showPendingState;
			if (showPendingState) {
				setState((current) =>
					withBusyStatus(current, 'activating', `Confirming your ${tierLabel} subscription...`)
				);
			}
			const started = Date.now();
			while (Date.now() - started < ACTIVATION_TIMEOUT_MS) {
				try {
					const subscription = await fetchMySubscription();
					if (subscription.tier === tierId && subscription.billingManaged) {
						captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'activated', location });
						setState((current) =>
							withActivatedTier(
								client
									? withReadySession(current, {
											authenticated: Boolean(client.user),
											tier: subscription.tier,
											tierLabel: subscription.tierLabel,
											billingManaged: subscription.billingManaged,
											userLabel: client.user?.email ?? client.user?.firstName ?? null
										})
									: current,
								subscription.tier,
								subscription.tierLabel
							)
						);
						return;
					}
					if (client && !sessionReconciled) {
						setState((current) =>
							withReadySession(current, {
								authenticated: Boolean(client.user),
								tier: subscription.tier,
								tierLabel: subscription.tierLabel,
								billingManaged: subscription.billingManaged,
								userLabel: client.user?.email ?? client.user?.firstName ?? null,
								message: current.message
							})
						);
						sessionReconciled = true;
					}
				} catch {
					// The webhook may still be in flight.
				}
				await new Promise((resolve) => window.setTimeout(resolve, ACTIVATION_POLL_MS));
			}
			if (!showPendingState) return;
			captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'activation_pending', location });
			setState((current) => withActivationTimeout(current, tierLabel));
		},
		[]
	);

	useEffect(() => {
		let active = true;
		const checkoutFromUrl = checkoutRequestFromSearch();
		if (checkoutFromUrl) {
			setInterval(checkoutFromUrl.interval);
			setCheckoutTierId(checkoutFromUrl.tierId);
			window.history.replaceState(
				window.history.state,
				'',
				pricingUrlWithoutCheckoutCommand(window.location.href)
			);
		}
		const checkout = new URLSearchParams(window.location.search).get('checkout');
		const returnTierId = new URLSearchParams(window.location.search).get('tier')?.trim() || 'pro';

		const onCheckoutProgress = (event: Event) => {
			if (!(event instanceof CustomEvent)) return;
			const progress = event.detail as CheckoutProgress;
			setInterval(progress.interval);
			setCheckoutTierId(progress.tierId);
			if (progress.status === 'error') {
				setState((current) => withError(current, progress.message));
				captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'error', location });
				return;
			}
			if (progress.status === 'checkout_closed') {
				setState((current) => withReadyStatus(current, progress.message));
				captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'overlay_closed', location });
				void waitForTierActivation(progress.tierId, progress.tierId, false).catch(() => {});
				return;
			}
			const status =
				progress.status === 'signing_in'
					? 'signing_in'
					: progress.status === 'checkout_open'
						? 'checkout_open'
						: 'starting_checkout';
			setState((current) => withBusyStatus(current, status, progress.message));
			if (progress.status === 'checkout_open') {
				captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'overlay_opened', location });
			}
		};
		document.addEventListener(PRICING_CHECKOUT_PROGRESS_EVENT, onCheckoutProgress);

		void (async () => {
			try {
				if (initialCatalog || checkoutFromUrl) {
					void fetchPublicPricingCatalog()
						.then((next) => active && setCatalog(next))
						.catch(() => {});
				} else {
					const next = await fetchPublicPricingCatalog();
					if (active) setCatalog(next);
				}
				if (checkoutFromUrl) {
					if (active) await runCheckout(checkoutFromUrl.tierId, checkoutFromUrl.interval);
					return;
				}
				await refreshSession();
				if (checkout === 'cancel') {
					setState((current) =>
						withReadyStatus(current, 'Checkout was cancelled. You can try again anytime.')
					);
				}
				if (checkout === 'return') {
					const tierLabel =
						initialCatalog?.plans.find((plan) => plan.id === returnTierId)?.label ?? returnTierId;
					await waitForTierActivation(returnTierId, tierLabel);
				}
				if (checkout === 'return' || checkout === 'cancel')
					window.history.replaceState({}, '', '/pricing');
			} catch (error) {
				if (active) {
					setState((current) =>
						withError(
							current,
							error instanceof Error ? error.message : 'Could not load pricing or account details.'
						)
					);
				}
			}
		})();

		return () => {
			active = false;
			document.removeEventListener(PRICING_CHECKOUT_PROGRESS_EVENT, onCheckoutProgress);
		};
	}, [initialCatalog, refreshSession, waitForTierActivation]);

	function selectInterval(next: BillingInterval) {
		setInterval(next);
		captureAnalyticsEvent(INTERVAL_SELECTED_EVENT, { interval: next, location });
	}

	async function selectPlan(planId: string) {
		captureAnalyticsEvent(CTA_CLICKED_EVENT, { cta: `pricing_${planId}`, location, interval });
		if (planId === 'free') {
			window.location.assign('/#sprocket');
			return;
		}
		if (!canStartCheckout(state)) {
			setState((current) => withError(current, 'A paid plan is already active on this account.'));
			return;
		}
		if (!planIsAvailable(catalog, planId, interval)) {
			setState((current) => withError(current, 'This billing interval is not available.'));
			return;
		}
		setCheckoutTierId(planId);
		captureAnalyticsEvent(CHECKOUT_STARTED_EVENT, { interval, location, plan: planId });
		await runCheckout(planId, interval);
	}

	async function manageBilling() {
		captureAnalyticsEvent(CTA_CLICKED_EVENT, { cta: 'pricing_manage_billing', location });
		try {
			setState((current) =>
				withBusyStatus(current, 'managing_billing', 'Opening billing portal...')
			);
			window.location.assign(await openCustomerPortal());
		} catch (error) {
			setState((current) =>
				withError(
					current,
					error instanceof Error ? error.message : 'Could not open the billing portal.'
				)
			);
		}
	}

	async function signOut() {
		captureAnalyticsEvent(CTA_CLICKED_EVENT, { cta: 'pricing_sign_out', location });
		await signOutOfPricing();
		setState((current) =>
			withReadySession(current, {
				authenticated: false,
				tier: 'free',
				tierLabel: 'Free',
				billingManaged: false,
				userLabel: null
			})
		);
	}

	function planButtonLabel(plan: BillingPlan): string {
		if (plan.id === 'free') return plan.buttonText;
		const isCurrentTier = state.tier === plan.id;
		if (state.status === 'managing_billing' && isCurrentTier) return 'Opening billing portal...';
		if (checkoutTierId === plan.id) {
			if (state.status === 'signing_in') return 'Redirecting to sign in...';
			if (state.status === 'starting_checkout') return 'Starting checkout...';
			if (state.status === 'checkout_open') return 'Checkout opened';
			if (state.status === 'activating') return `Confirming ${plan.title}...`;
		}
		if (isCurrentTier && showsManageBilling(state)) return 'Manage billing';
		if (isPaidTier(state.tier)) return isCurrentTier ? 'Current plan' : 'Paid plan already active';
		if (!planIsAvailable(catalog, plan.id, interval)) return 'Unavailable';
		return plan.buttonText;
	}

	const account = (
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
			{state.authenticated && state.userLabel ? (
				<div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
					<p>
						Signed in as <span className="text-foreground">{state.userLabel}</span>
						{isPaidTier(state.tier) ? (
							<>
								. Current plan: <span className="text-foreground">{state.tierLabel}</span>
							</>
						) : null}
					</p>
					<button
						type="button"
						className="font-medium text-accent-strong underline decoration-accent-strong/30 underline-offset-4"
						onClick={() => void signOut()}
					>
						Sign out
					</button>
				</div>
			) : null}
		</>
	);

	return (
		<>
			{plans.length > 0 ? (
				<PricingTableOne
					plans={plans}
					interval={interval}
					onIntervalChange={selectInterval}
					onPlanSelect={(planId) =>
						planId === state.tier && showsManageBilling(state)
							? void manageBilling()
							: void selectPlan(planId)
					}
					buttonLabel={planButtonLabel}
					buttonDisabled={(plan) => {
						if (checkoutInFlight) return true;
						if (plan.id === 'free') return false;
						if (isPaidTier(state.tier)) {
							return plan.id !== state.tier || !showsManageBilling(state);
						}
						return !planIsAvailable(catalog, plan.id, interval);
					}}
					headerFooter={account}
				/>
			) : (
				<div className="py-24 text-center">
					<h1 className="font-brand text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
						Pricing
					</h1>
					{account}
					<p className="mt-10 text-sm text-muted-foreground" role="status">
						Loading plan details...
					</p>
				</div>
			)}

			<section
				className="mt-20"
				aria-labelledby="pricing-faq-heading"
				data-ph-section="pricing_faq"
			>
				<h2 id="pricing-faq-heading" className="font-brand text-2xl font-semibold text-foreground">
					FAQ
				</h2>
				<div className="mt-6 space-y-4">
					{pricingFaqs.map((faq) => (
						<details
							className="group rounded-2xl border border-border/70 bg-surface/90 p-5"
							key={faq.question}
						>
							<summary className="cursor-pointer list-none font-brand text-lg font-semibold text-foreground marker:content-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
								<span className="flex items-center justify-between gap-3">
									{faq.question}
									<span
										className="text-muted-foreground transition-transform group-open:rotate-45"
										aria-hidden="true"
									>
										+
									</span>
								</span>
							</summary>
							<p className="mt-3 text-base leading-relaxed text-muted-foreground">{faq.answer}</p>
						</details>
					))}
				</div>
			</section>
		</>
	);
}
