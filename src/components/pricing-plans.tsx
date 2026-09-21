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
	ENTERPRISE_MAILTO,
	pricingFaqs,
	proPriceLabel,
	type BillingInterval
} from '@/lib/pricing/catalog';
import {
	createInitialPricingState,
	canStartCheckout,
	showsManageBilling,
	withActivatedPro,
	withActivationTimeout,
	withBusyStatus,
	withError,
	withReadySession,
	withReadyStatus,
	type PricingUiState
} from '@/lib/pricing/checkout-state';
import {
	checkoutIntervalFromSearch,
	pricingUrlWithoutCheckoutCommand,
	PRICING_CHECKOUT_PROGRESS_EVENT,
	runProCheckout,
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

function planPrice(planId: string, proPrice: number | undefined): string {
	if (planId === 'free') return '0';
	if (planId === 'enterprise') return 'Custom';
	return proPrice === undefined ? 'Unavailable' : String(proPrice);
}

function billingPlans(catalog: PublicPricingCatalog): BillingPlan[] {
	const plans = buildPricingPlans(catalog);
	const monthly = proPriceLabel('monthly', catalog.proPrices);
	const annual = proPriceLabel('annual', catalog.proPrices);

	return plans.map((plan) => {
		const isPro = plan.id === 'pro';
		return {
			id: plan.id,
			title: plan.name,
			description:
				plan.id === 'free'
					? 'For trying Sprocket and building without a card.'
					: plan.id === 'pro'
						? 'For regular AI-assisted engineering work.'
						: 'For teams with custom rollout and purchasing needs.',
			highlight: plan.highlighted,
			badge: plan.highlighted ? 'Most popular' : undefined,
			currency: isPro && monthly ? currencySymbol(monthly.currency) : '',
			monthlyPrice: planPrice(plan.id, monthly?.periodMajor),
			yearlyPrice: planPrice(plan.id, annual?.periodMajor),
			buttonText:
				plan.id === 'free' ? 'Start free' : plan.id === 'pro' ? 'Get Pro' : 'Contact sales',
			features: plan.features.map((feature) => ({ name: feature, icon: 'check' }))
		};
	});
}

function isPaidTier(tier: SubscriptionTier): boolean {
	return tier !== 'free';
}

export default function PricingPlans({ initialCatalog = null }: PricingPlansProps) {
	const [state, setState] = useState<PricingUiState>(() => createInitialPricingState());
	const [interval, setInterval] = useState<BillingInterval>('monthly');
	const [catalog, setCatalog] = useState<PublicPricingCatalog | null>(initialCatalog);
	const plans = useMemo(() => (catalog ? billingPlans(catalog) : []), [catalog]);
	const checkoutInFlight = state.busy;

	const refreshSession = useCallback(async (message: string | null = null) => {
		const client = await initializePricingBilling();
		let tier: SubscriptionTier = 'free';
		let billingManaged = false;
		if (client.user) {
			const subscription = await fetchMySubscription();
			tier = subscription.tier;
			billingManaged = subscription.billingManaged;
		}
		setState((current) =>
			withReadySession(current, {
				authenticated: Boolean(client.user),
				tier,
				billingManaged,
				userLabel: client.user?.email ?? client.user?.firstName ?? null,
				message
			})
		);
	}, []);

	const waitForProActivation = useCallback(async () => {
		setState((current) =>
			withBusyStatus(current, 'activating', 'Confirming your Pro subscription...')
		);
		const started = Date.now();
		while (Date.now() - started < ACTIVATION_TIMEOUT_MS) {
			try {
				const subscription = await fetchMySubscription();
				if (subscription.tier === 'pro' && subscription.billingManaged) {
					captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'activated', location });
					setState((current) => withActivatedPro(current));
					return;
				}
			} catch {
				// The webhook may still be in flight.
			}
			await new Promise((resolve) => window.setTimeout(resolve, ACTIVATION_POLL_MS));
		}
		captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'activation_pending', location });
		setState((current) => withActivationTimeout(current));
	}, []);

	useEffect(() => {
		let active = true;
		const checkoutFromUrl = checkoutIntervalFromSearch();
		if (checkoutFromUrl) {
			setInterval(checkoutFromUrl);
			window.history.replaceState(
				window.history.state,
				'',
				pricingUrlWithoutCheckoutCommand(window.location.href)
			);
		}
		const checkout = new URLSearchParams(window.location.search).get('checkout');

		const onCheckoutProgress = (event: Event) => {
			if (!(event instanceof CustomEvent)) return;
			const progress = event.detail as CheckoutProgress;
			setInterval(progress.interval);
			if (progress.status === 'error') {
				setState((current) => withError(current, progress.message));
				captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'error', location });
				return;
			}
			if (progress.status === 'checkout_closed') {
				setState((current) => withReadyStatus(current, progress.message));
				captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'overlay_closed', location });
				void refreshSession().catch(() => {});
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
					if (active) await runProCheckout(checkoutFromUrl);
					return;
				}
				await refreshSession();
				if (checkout === 'cancel') {
					setState((current) =>
						withReadyStatus(current, 'Checkout was cancelled. You can try again anytime.')
					);
				}
				if (checkout === 'return') await waitForProActivation();
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
	}, [initialCatalog, refreshSession, waitForProActivation]);

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
		if (planId === 'enterprise') {
			window.location.assign(ENTERPRISE_MAILTO);
			return;
		}
		if (!canStartCheckout(state)) {
			setState((current) => withError(current, 'A paid plan is already active on this account.'));
			return;
		}
		captureAnalyticsEvent(CHECKOUT_STARTED_EVENT, { interval, location, plan: 'pro' });
		await runProCheckout(interval);
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
				billingManaged: false,
				userLabel: null
			})
		);
	}

	function planButtonLabel(plan: BillingPlan): string {
		if (plan.id !== 'pro') return plan.buttonText;
		if (state.status === 'managing_billing') return 'Opening billing portal...';
		if (state.status === 'signing_in') return 'Redirecting to sign in...';
		if (state.status === 'starting_checkout') return 'Starting checkout...';
		if (state.status === 'checkout_open') return 'Checkout opened';
		if (state.status === 'activating') return 'Confirming Pro...';
		if (showsManageBilling(state)) return 'Manage billing';
		if (isPaidTier(state.tier)) return 'Current plan active';
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
								. Current plan: <span className="text-foreground capitalize">{state.tier}</span>
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
						planId === 'pro' && showsManageBilling(state)
							? void manageBilling()
							: void selectPlan(planId)
					}
					buttonLabel={planButtonLabel}
					buttonDisabled={(plan) =>
						plan.id === 'pro' &&
						(checkoutInFlight ||
							!catalog?.proPrices ||
							(!showsManageBilling(state) && isPaidTier(state.tier)))
					}
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
