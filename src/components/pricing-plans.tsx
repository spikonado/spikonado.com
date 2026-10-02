import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PricingTableOne } from '@/components/billingsdk/pricing-table-one';
import { PricingAccount } from '@/components/pricing-account';
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
	fetchCheckoutStatus,
	fetchMySubscription,
	fetchPublicPricingCatalog,
	initializePricingBilling,
	openCustomerPortal,
	signOutOfPricing,
	type CheckoutStatus,
	type MySubscription,
	type PublicPricingCatalog
} from '@/lib/pricing/billing-client';
import {
	buildPricingPlans,
	currencyCodeLabel,
	priceLabel,
	pricingBasePriceCaveat,
	pricingFaqs,
	pricesForPlan,
	type BillingInterval
} from '@/lib/pricing/catalog';
import { createCheckoutOverlay, type CheckoutOverlay } from '@/lib/pricing/checkout-overlay';
import {
	createInitialPricingState,
	canStartCheckout,
	effectiveCheckoutEligibility,
	resolveCheckoutEligibility,
	showsManageBilling,
	withActivatedTier,
	withBusyStatus,
	withConfirmationPending,
	withError,
	withReadySession,
	withReadyStatus,
	type PricingUiState
} from '@/lib/pricing/checkout-state';
import { createBillingOperations, type OperationGuard } from '@/lib/pricing/operation';
import {
	clearCheckoutAttempt,
	clearPendingPricingAction,
	readCheckoutAttempt
} from '@/lib/pricing/pending';
import {
	checkoutRequestFromSearch,
	PRICING_CHECKOUT_PROGRESS_EVENT,
	pricingUrlWithoutCheckoutCommand,
	runCheckout,
	type CheckoutProgress
} from '@/lib/pricing/start-checkout';

interface PricingPlansProps {
	initialCatalog?: PublicPricingCatalog | null;
}

const location: AnalyticsLocation = 'pricing_page';
const ACTIVATION_TIMEOUT_MS = 30_000;
const ACTIVATION_POLL_MS = 2_000;

function accountIdFrom(user: { id?: unknown; email?: unknown } | null): string | null {
	if (!user) return null;
	const id = typeof user.id === 'string' ? user.id.trim() : '';
	if (id) return id;
	const email = typeof user.email === 'string' ? user.email.trim() : '';
	return email || null;
}

function planPrice(planId: string, price: number | undefined): string {
	if (planId === 'free') return '0';
	return price === undefined ? 'Unavailable' : String(price);
}

function billingPlans(catalog: PublicPricingCatalog, interval: BillingInterval): BillingPlan[] {
	const plans = buildPricingPlans(catalog);

	return plans.map((plan) => {
		const source = catalog.plans.find((candidate) => candidate.id === plan.id);
		if (!source) throw new Error(`Pricing plan "${plan.id}" is missing from the catalog.`);
		const prices = pricesForPlan(source);
		const monthly = priceLabel('monthly', prices);
		const annual = priceLabel('annual', prices);
		const selected = priceLabel(interval, prices);
		return {
			id: plan.id,
			title: plan.name,
			description: plan.description,
			highlight: plan.highlighted,
			badge: plan.highlighted ? 'Most popular' : undefined,
			currency: currencyCodeLabel(
				selected?.currency ?? monthly?.currency ?? annual?.currency ?? 'USD'
			),
			monthlyPrice: planPrice(plan.id, monthly?.periodMajor),
			monthlyCurrency: monthly?.currency,
			yearlyPrice: planPrice(plan.id, annual?.periodMajor),
			yearlyCurrency: annual?.currency,
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
	return Boolean(plan && pricesForPlan(plan)[interval]);
}

function planIsPaid(catalog: PublicPricingCatalog | null, planId: string): boolean {
	const plan = catalog?.plans.find((candidate) => candidate.id === planId);
	return Boolean(plan && (pricesForPlan(plan).monthly || pricesForPlan(plan).annual));
}

export default function PricingPlans({ initialCatalog = null }: PricingPlansProps) {
	const [state, setState] = useState<PricingUiState>(() => createInitialPricingState());
	const [interval, setInterval] = useState<BillingInterval>('monthly');
	const [catalog, setCatalog] = useState<PublicPricingCatalog | null>(initialCatalog);
	const [checkoutTierId, setCheckoutTierId] = useState<string | null>(null);
	const overlayRef = useRef<CheckoutOverlay | null>(null);
	const operationsRef = useRef<ReturnType<typeof createBillingOperations> | null>(null);
	const catalogRef = useRef<PublicPricingCatalog | null>(initialCatalog);
	const accountRef = useRef<string | null>(null);
	catalogRef.current = catalog;
	const plans = useMemo(
		() => (catalog ? billingPlans(catalog, interval) : []),
		[catalog, interval]
	);
	// Creation and processing block new selections; an open overlay does not —
	// the user may replace it with another plan or interval.
	const checkoutInFlight =
		state.busy && state.status !== 'checkout_open' && state.status !== 'idle';

	function getOverlay(): CheckoutOverlay {
		overlayRef.current ??= createCheckoutOverlay();
		return overlayRef.current;
	}

	function getOperations() {
		operationsRef.current ??= createBillingOperations();
		return operationsRef.current;
	}

	const refreshSession = useCallback(
		async (message: string | null = null, guard: OperationGuard | null = null) => {
			const isCurrent = () => (guard ? guard.isCurrent() : true);
			if (!isCurrent()) return null;
			const client = await initializePricingBilling();
			if (!isCurrent()) return null;
			// client.user is a snapshot from initialization time; the auth client
			// holds the live account after any sign-out or switch above.
			const user = (client.auth?.getUser() ?? null) || null;
			const accountId = accountIdFrom(user);
			let subscription: MySubscription = {
				tier: 'free',
				tierLabel: 'Free',
				billingManaged: false
			};
			if (user && isCurrent()) {
				subscription = await fetchMySubscription(accountId ?? undefined);
				if (!isCurrent()) return null;
			}
			if (accountIdFrom(client.auth?.getUser() ?? null) !== accountId) return null;
			accountRef.current = accountId;
			const eligibility = resolveCheckoutEligibility({
				checkoutEligibility: subscription.checkoutEligibility
			});
			setState((current) => {
				if (!isCurrent()) return current;
				return withReadySession(current, {
					authenticated: Boolean(user),
					tier: subscription.tier,
					tierLabel: subscription.tierLabel,
					billingManaged: subscription.billingManaged,
					checkoutEligibility: eligibility ?? undefined,
					accessPhase:
						typeof subscription.accessPhase === 'string' ? subscription.accessPhase : undefined,
					userLabel: user?.email ?? user?.firstName ?? null,
					message
				});
			});
			if (!isCurrent()) return null;
			return {
				tier: subscription.tier,
				tierLabel: subscription.tierLabel,
				billingManaged: subscription.billingManaged,
				checkoutEligibility: eligibility,
				authenticated: Boolean(user),
				accountId
			};
		},
		[]
	);

	/**
	 * Poll for activation of a specific account-owned checkout attempt. Activation
	 * is only claimed when the backend confirms that exact attempt activated
	 * (`getCheckoutStatus` activated flag) and the subscription projection
	 * reflects the purchased tier. A matching tier from any other purchase, an
	 * unsigned URL parameter, or a provider status alone never proves activation.
	 */
	const waitForTierActivation = useCallback(
		async (
			tierId: string,
			tierLabel: string,
			guard: OperationGuard,
			attemptId: string,
			accountId: string,
			showPendingState = true,
			initialStatus: CheckoutStatus | null = null
		) => {
			const isCurrent = guard.isCurrent;
			if (!isCurrent()) return;
			if (showPendingState) {
				setState((current) =>
					isCurrent()
						? withBusyStatus(current, 'activating', `Confirming your ${tierLabel} subscription...`)
						: current
				);
			}
			const started = Date.now();
			let suppliedStatus = initialStatus;
			while (isCurrent() && Date.now() - started < ACTIVATION_TIMEOUT_MS) {
				try {
					const status = suppliedStatus ?? (await fetchCheckoutStatus(attemptId, accountId));
					suppliedStatus = null;
					if (!isCurrent()) return;
					if (status.activated === true) {
						const subscription = await fetchMySubscription(accountId);
						if (!isCurrent()) return;
						if (subscription.tier === tierId && subscription.billingManaged) {
							captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'activated', location });
							setState((current) =>
								isCurrent()
									? withActivatedTier(current, subscription.tier, subscription.tierLabel)
									: current
							);
							return;
						}
					}
				} catch {
					// The webhook may still be in flight; keep polling until the bound.
				}
				await new Promise((resolve) => setTimeout(resolve, ACTIVATION_POLL_MS));
			}
			if (!showPendingState || !isCurrent()) return;
			captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'activation_pending', location });
			setState((current) =>
				isCurrent() ? withConfirmationPending(current, tierLabel, attemptId) : current
			);
		},
		[]
	);

	const recoverStoredAttempt = useCallback(
		async (guard: OperationGuard) => {
			const client = await initializePricingBilling();
			if (!guard.isCurrent()) return;
			const accountId = accountIdFrom(client.user);
			const attempt = readCheckoutAttempt(accountId);
			if (!attempt || !accountId) return;
			let status: CheckoutStatus;
			try {
				const result = await fetchCheckoutStatus(attempt.attemptId, accountId);
				if (!guard.isCurrent()) return;
				status = result;
			} catch {
				if (!guard.isCurrent()) return;
				setState((current) =>
					guard.isCurrent()
						? withReadyStatus(
								current,
								'Could not check your previous checkout status. If you completed a payment, your plan will update automatically once confirmed.'
							)
						: current
				);
				return;
			}
			// Neutral provider state only narrows messaging. The server `activated`
			// flag authoritatively gates whether we poll this attempt for activation.
			if (status.status === 'failed' || status.status === 'expired') {
				clearCheckoutAttempt();
				setState((current) =>
					guard.isCurrent()
						? withReadyStatus(
								current,
								'Your previous checkout did not complete. You can start a new checkout below.'
							)
						: current
				);
				return;
			}
			const planLabel =
				catalogRef.current?.plans.find((plan) => plan.id === attempt.tierId)?.label ??
				attempt.tierId;
			await waitForTierActivation(
				attempt.tierId,
				planLabel,
				guard,
				attempt.attemptId,
				accountId,
				true,
				status
			);
		},
		[waitForTierActivation]
	);

	useEffect(() => {
		let active = true;
		const operations = getOperations();
		const mountGuard = operations.begin('portal', 'mount', null);
		const isCurrent = () => active && mountGuard.isCurrent();
		const searchParams = new URLSearchParams(window.location.search);
		const checkout = searchParams.get('checkout');
		const returnTierId = searchParams.get('tier')?.trim() || null;
		const checkoutFromUrl =
			checkout === 'start' ? checkoutRequestFromSearch(window.location.search) : null;
		if (checkoutFromUrl) {
			setInterval(checkoutFromUrl.interval);
			setCheckoutTierId(checkoutFromUrl.tierId);
		}

		const onCheckoutProgress = (event: Event) => {
			if (!(event instanceof CustomEvent)) return;
			const progress = event.detail as CheckoutProgress;
			// Apply only progress from the operation that started the checkout. A
			// delayed event from a superseded operation (sign-out, account switch,
			// unmount, newer click) carries a stale generation and is dropped.
			if (!active) return;
			if (progress.generation !== operations.currentGeneration()) return;
			setInterval(progress.interval);
			setCheckoutTierId(progress.tierId);
			const progressCurrent = () => progress.generation === operations.currentGeneration();
			if (progress.status === 'error') {
				setState((current) => (progressCurrent() ? withError(current, progress.message) : current));
				captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'error', location });
				return;
			}
			if (progress.status === 'checkout_closed') {
				setState((current) =>
					progressCurrent() ? withReadyStatus(current, progress.message) : current
				);
				captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'overlay_closed', location });
				// Poll for activation of the exact account-owned attempt that just
				// closed, under a fresh guard bound to the current operation.
				if (progress.attemptId && progress.accountId) {
					const planLabel =
						catalogRef.current?.plans.find((plan) => plan.id === progress.tierId)?.label ??
						progress.tierId;
					const activationGuard = operations.begin('portal', progress.accountId, null);
					void waitForTierActivation(
						progress.tierId,
						planLabel,
						activationGuard,
						progress.attemptId,
						progress.accountId,
						false
					).catch(() => {});
				}
				return;
			}
			if (!progressCurrent()) return;
			const status =
				progress.status === 'signing_in'
					? 'signing_in'
					: progress.status === 'checkout_open'
						? 'checkout_open'
						: 'starting_checkout';
			setState((current) =>
				progressCurrent() ? withBusyStatus(current, status, progress.message) : current
			);
			if (progress.status === 'checkout_open') {
				captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'overlay_opened', location });
			}
		};
		document.addEventListener(PRICING_CHECKOUT_PROGRESS_EVENT, onCheckoutProgress);

		void (async () => {
			try {
				let liveCatalog = initialCatalog;
				if (initialCatalog && !checkoutFromUrl) {
					void fetchPublicPricingCatalog()
						.then((next) => isCurrent() && setCatalog(next))
						.catch(() => {});
				} else {
					liveCatalog = await fetchPublicPricingCatalog();
					if (isCurrent()) setCatalog(liveCatalog);
				}
				if (checkoutFromUrl) {
					if (!isCurrent()) return;
					if (!planIsPaid(liveCatalog, checkoutFromUrl.tierId)) {
						await refreshSession(
							'Checkout links only work for paid plans. Pick a paid plan below.',
							mountGuard
						);
						return;
					}
					if (!planIsAvailable(liveCatalog, checkoutFromUrl.tierId, checkoutFromUrl.interval)) {
						await refreshSession('This billing interval is not available.', mountGuard);
						return;
					}
					const session = await refreshSession(null, mountGuard);
					if (!isCurrent() || !session) return;
					if (session.checkoutEligibility && session.checkoutEligibility !== 'purchasable') {
						return;
					}
					if (!session.checkoutEligibility && session.tier !== 'free') return;
					window.history.replaceState(
						window.history.state,
						'',
						pricingUrlWithoutCheckoutCommand(window.location.href)
					);
					const overlay = getOverlay();
					const guard = operations.begin('checkout', session.accountId ?? 'unknown', overlay);
					await runCheckout(checkoutFromUrl.tierId, checkoutFromUrl.interval, {
						overlay,
						guard
					});
					return;
				}
				const session = await refreshSession(
					checkout === 'return' && !returnTierId
						? 'Checkout returned without a plan selection. Your current account status is shown below.'
						: null,
					mountGuard
				);
				if (!isCurrent() || !session) return;
				if (checkout === 'cancel') {
					setState((current) =>
						withReadyStatus(current, 'Checkout was cancelled. You can try again anytime.')
					);
				}
				// Tier/return parameters are navigation hints only; they never claim
				// activation by themselves. Recovery is driven by the account-owned
				// attempt reference, which authorizes the server status lookup.
				if (session.authenticated && session.accountId) {
					await recoverStoredAttempt(mountGuard);
				}
				if (checkout === 'return' || checkout === 'cancel')
					window.history.replaceState({}, '', '/pricing');
			} catch (error) {
				if (isCurrent()) {
					setState((current) =>
						isCurrent()
							? withError(
									current,
									error instanceof Error
										? error.message
										: 'Could not load pricing or account details.'
								)
							: current
					);
				}
			}
		})();

		return () => {
			active = false;
			operations.bumpGeneration();
			document.removeEventListener(PRICING_CHECKOUT_PROGRESS_EVENT, onCheckoutProgress);
		};
	}, [initialCatalog, refreshSession, waitForTierActivation, recoverStoredAttempt]);

	function selectInterval(next: BillingInterval) {
		setInterval(next);
		captureAnalyticsEvent(INTERVAL_SELECTED_EVENT, { interval: next, location });
	}

	async function selectPlan(planId: string, planInterval: BillingInterval = interval) {
		captureAnalyticsEvent(CTA_CLICKED_EVENT, {
			cta: `pricing_${planId}`,
			location,
			interval: planInterval
		});
		if (planId === 'free') {
			window.location.assign('/#sprocket');
			return;
		}
		// An open overlay must not trap the user: picking another plan or
		// interval supersedes it and closes it below. Only creation/processing
		// work (starting checkout, activating, portal navigation) blocks a new
		// selection.
		if (!canStartCheckout(state) && state.status !== 'checkout_open') {
			const eligibility = effectiveCheckoutEligibility(state);
			const message =
				eligibility === 'checkout_disabled'
					? 'New purchases are temporarily unavailable. You can still manage billing in the portal.'
					: eligibility === 'repair_required'
						? 'A payment for your subscription needs attention. Open the billing portal to repair it.'
						: eligibility === 'confirmation_pending'
							? 'A payment is still being confirmed. Check its status instead of starting another checkout.'
							: 'A paid plan is already active on this account.';
			setState((current) => withError(current, message));
			return;
		}
		if (!planIsAvailable(catalog, planId, planInterval)) {
			setState((current) => withError(current, 'This billing interval is not available.'));
			return;
		}
		setCheckoutTierId(planId);
		const operations = getOperations();
		// Capture the generation and account before any await so a sign-out or
		// account switch during initialization aborts this operation.
		operations.bumpGeneration();
		captureAnalyticsEvent(CHECKOUT_STARTED_EVENT, {
			interval: planInterval,
			location,
			plan: planId
		});
		const overlay = getOverlay();
		const expectedAccount = accountRef.current;
		const probe = operations.begin('checkout', 'pending', null);
		const client = await initializePricingBilling().catch(() => null);
		const sessionAccount = accountIdFrom(client?.auth?.getUser() ?? null);
		if (
			!probe.isCurrent() ||
			sessionAccount !== expectedAccount ||
			expectedAccount !== accountRef.current
		)
			return;
		const guard = operations.begin('checkout', sessionAccount ?? 'unknown', overlay);
		await runCheckout(planId, planInterval, { overlay, guard });
	}

	async function manageBilling() {
		const operations = getOperations();
		// Capture the generation and account before any await so a sign-out or
		// account switch during initialization aborts this operation.
		operations.bumpGeneration();
		captureAnalyticsEvent(CTA_CLICKED_EVENT, { cta: 'pricing_manage_billing', location });
		const expectedAccount = accountRef.current;
		const probe = operations.begin('portal', 'pending', null);
		const client = await initializePricingBilling().catch(() => null);
		const account = accountIdFrom(client?.auth?.getUser() ?? null);
		if (!probe.isCurrent() || account !== expectedAccount || expectedAccount !== accountRef.current)
			return;
		const guard = operations.begin('portal', account ?? 'unknown', null);
		try {
			setState((current) =>
				guard.isCurrent()
					? withBusyStatus(current, 'managing_billing', 'Opening billing portal...')
					: current
			);
			const portalUrl = await openCustomerPortal(account ?? undefined);
			guard.assertCurrent();
			window.location.assign(portalUrl);
		} catch (error) {
			setState((current) =>
				guard.isCurrent()
					? withError(
							current,
							error instanceof Error ? error.message : 'Could not open the billing portal.'
						)
					: current
			);
		}
	}

	async function checkPaymentStatus() {
		const operations = getOperations();
		// Capture the generation and account before any await so a sign-out or
		// account switch during initialization aborts this operation.
		operations.bumpGeneration();
		const expectedAccount = accountRef.current;
		const probe = operations.begin('portal', 'pending', null);
		const client = await initializePricingBilling().catch(() => null);
		const account = accountIdFrom(client?.auth?.getUser() ?? null);
		if (!probe.isCurrent() || account !== expectedAccount || expectedAccount !== accountRef.current)
			return;
		const guard = operations.begin('portal', account ?? 'unknown', null);
		try {
			// Activation is only claimed for the account-owned attempt stored at
			// checkout time; a matching tier from any other purchase proves nothing.
			const attempt = readCheckoutAttempt(account);
			if (!attempt) {
				await refreshSession('Your payment is still being confirmed.', guard);
				return;
			}
			const status = await fetchCheckoutStatus(attempt.attemptId, account ?? undefined);
			if (!guard.isCurrent()) return;
			if (status.activated === true) {
				const subscription = await fetchMySubscription(account ?? undefined);
				if (!guard.isCurrent()) return;
				if (subscription.tier !== 'free' && subscription.billingManaged) {
					setState((current) =>
						guard.isCurrent()
							? withActivatedTier(current, subscription.tier, subscription.tierLabel)
							: current
					);
					clearCheckoutAttempt();
					return;
				}
			}
			await refreshSession('Your payment is still being confirmed.', guard);
		} catch (error) {
			setState((current) =>
				guard.isCurrent()
					? withError(
							current,
							error instanceof Error ? error.message : 'Could not check the payment status.'
						)
					: current
			);
		}
	}

	async function signOut() {
		captureAnalyticsEvent(CTA_CLICKED_EVENT, { cta: 'pricing_sign_out', location });
		clearPendingPricingAction();
		clearCheckoutAttempt();
		const operations = getOperations();
		// Invalidate every in-flight operation and close overlays immediately,
		// before awaiting the network sign-out below.
		operations.bumpGeneration();
		accountRef.current = null;
		setState((current) => ({ ...current, busy: false }));
		const probe = operations.begin('portal', 'signed-out', null);
		await signOutOfPricing();
		// A component unmount or account replacement during the network call must
		// not resurrect a signed-out view over the current UI.
		if (probe.isCurrent()) {
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
	}

	function planButtonLabel(plan: BillingPlan): string {
		if (plan.id === 'free') return plan.buttonText;
		const isCurrentTier = state.tier === plan.id;
		const eligibility = effectiveCheckoutEligibility(state);
		if (state.status === 'managing_billing' && isCurrentTier) return 'Opening billing portal...';
		if (checkoutTierId === plan.id) {
			if (state.status === 'signing_in') return 'Redirecting to sign in...';
			if (state.status === 'starting_checkout') return 'Starting checkout...';
			if (state.status === 'checkout_open') return 'Checkout opened';
			if (state.status === 'activating') return `Confirming ${plan.title}...`;
		}
		if (isCurrentTier && showsManageBilling(state)) return 'Manage billing';
		if (isCurrentTier) return 'Current plan';
		if (eligibility === 'checkout_disabled') return 'Checkout unavailable';
		if (eligibility === 'repair_required') return 'Repair in billing portal';
		if (eligibility === 'confirmation_pending') return 'Payment confirming';
		if (eligibility === 'active') return 'Paid plan already active';
		if (!planIsAvailable(catalog, plan.id, interval)) return 'Unavailable';
		return plan.buttonText;
	}

	const account = (
		<PricingAccount
			state={state}
			onManageBilling={() => void manageBilling()}
			onCheckStatus={() => void checkPaymentStatus()}
			onSignOut={() => void signOut()}
		/>
	);

	return (
		<>
			{plans.length > 0 ? (
				<PricingTableOne
					plans={plans}
					interval={interval}
					onIntervalChange={selectInterval}
					onPlanSelect={(planId) =>
						planId !== 'free' && planId === state.tier && showsManageBilling(state)
							? void manageBilling()
							: void selectPlan(planId)
					}
					buttonLabel={planButtonLabel}
					buttonDisabled={(plan) => {
						if (checkoutInFlight) return true;
						if (plan.id === 'free') return false;
						if (plan.id === state.tier) return !showsManageBilling(state);
						if (state.status === 'checkout_open') return false;
						if (!canStartCheckout(state)) return true;
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
				<p className="mt-2 text-sm text-muted-foreground">{pricingBasePriceCaveat}</p>
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
