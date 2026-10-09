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
	type MySubscription,
	type PublicPricingCatalog
} from '@/lib/pricing/billing-client';
import {
	buildPricingPlans,
	majorFromMinor,
	pricingFaqs,
	type BillingInterval
} from '@/lib/pricing/catalog';
import {
	createInitialPricingState,
	canStartCheckout,
	showsManageBilling,
	withActivatedTier,
	withBusyStatus,
	withError,
	withPaymentPending,
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

function billingPlans(catalog: PublicPricingCatalog): BillingPlan[] {
	const plans = buildPricingPlans(catalog);

	return plans.map((plan) => {
		const source = catalog.plans.find((candidate) => candidate.id === plan.id);
		if (!source) throw new Error(`Pricing plan "${plan.id}" is missing from the catalog.`);
		const { monthly, annual } = source.prices;
		return {
			id: plan.id,
			title: plan.name,
			description: plan.description,
			highlight: plan.highlighted,
			badge: plan.highlighted ? 'Most popular' : undefined,
			monthlyPrice:
				plan.id === 'free'
					? 0
					: monthly
						? majorFromMinor(monthly.amountMinor, monthly.currency)
						: null,
			monthlyCurrency: monthly?.currency ?? 'USD',
			yearlyPrice:
				plan.id === 'free'
					? 0
					: annual
						? majorFromMinor(annual.amountMinor, annual.currency)
						: null,
			yearlyCurrency: annual?.currency ?? 'USD',
			buttonText: plan.id === 'free' ? 'Start free' : `Get ${plan.name}`,
			features: plan.features.map((feature) => ({ name: feature }))
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
	return Boolean(plan?.prices[interval]);
}

function planIsPaid(catalog: PublicPricingCatalog | null, planId: string): boolean {
	const plan = catalog?.plans.find((candidate) => candidate.id === planId);
	return Boolean(plan && (plan.prices.monthly || plan.prices.annual));
}

export default function PricingPlans({ initialCatalog = null }: PricingPlansProps) {
	const [state, setState] = useState<PricingUiState>(() => createInitialPricingState());
	const [interval, setInterval] = useState<BillingInterval>('monthly');
	const [catalog, setCatalog] = useState<PublicPricingCatalog | null>(initialCatalog);
	const [checkoutTierId, setCheckoutTierId] = useState<string | null>(null);
	const operationsRef = useRef<ReturnType<typeof createBillingOperations> | null>(null);
	const catalogRef = useRef<PublicPricingCatalog | null>(initialCatalog);
	const accountRef = useRef<string | null>(null);
	catalogRef.current = catalog;
	const plans = useMemo(() => (catalog ? billingPlans(catalog) : []), [catalog]);
	function getOperations() {
		operationsRef.current ??= createBillingOperations();
		return operationsRef.current;
	}

	async function beginAccountOperation() {
		const operations = getOperations();
		const expectedAccount = accountRef.current;
		const probe = operations.begin(expectedAccount ?? 'signed-out');
		try {
			const client = await initializePricingBilling();
			if (!probe.isCurrent()) return null;
			const account = accountIdFrom(client.auth?.getUser() ?? null);
			if (account !== expectedAccount || accountRef.current !== expectedAccount) {
				throw new Error('Your account changed. Reload pricing before continuing.');
			}
			return probe;
		} catch (error) {
			setState((current) =>
				probe.isCurrent()
					? withError(
							current,
							error instanceof Error ? error.message : 'Could not reach billing. Try again.'
						)
					: current
			);
			return null;
		}
	}

	const refreshSession = useCallback(
		async (message: string | null = null, guard: OperationGuard | null = null) => {
			const isCurrent = () => (guard ? guard.isCurrent() : true);
			if (!isCurrent()) return null;
			const client = await initializePricingBilling();
			if (!isCurrent()) return null;
			const user = client.auth?.getUser() ?? null;
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
			setState((current) => {
				if (!isCurrent()) return current;
				return withReadySession(current, {
					authenticated: Boolean(user),
					tier: subscription.tier,
					tierLabel: subscription.tierLabel,
					billingManaged: subscription.billingManaged,
					userLabel: user?.email ?? user?.firstName ?? null,
					message
				});
			});
			if (!isCurrent()) return null;
			return {
				tier: subscription.tier,
				tierLabel: subscription.tierLabel,
				billingManaged: subscription.billingManaged,
				authenticated: Boolean(user),
				accountId
			};
		},
		[]
	);

	const applyAttemptStatus = useCallback(
		async (
			status: Awaited<ReturnType<typeof fetchCheckoutStatus>>,
			tierId: string,
			tierLabel: string,
			guard: OperationGuard,
			accountId: string
		): Promise<boolean> => {
			const isCurrent = guard.isCurrent;
			if (!isCurrent()) return true;
			if (status.status === 'awaiting_payment') {
				setState((current) =>
					isCurrent()
						? withPaymentPending(current, tierLabel, status.attemptId, status.checkout_url ?? null)
						: current
				);
				return true;
			}
			if (status.status === 'failed' || status.status === 'expired') {
				const session = await refreshSession(
					'Your previous checkout did not complete. You can start a new checkout below.',
					guard
				);
				if (!isCurrent() || !session) return true;
				clearCheckoutAttempt();
				return true;
			}
			if (status.activated === true) {
				const subscription = await fetchMySubscription(accountId);
				if (!isCurrent()) return true;
				if (subscription.tier === tierId && subscription.billingManaged) {
					captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'activated', location });
					setState((current) =>
						isCurrent()
							? withActivatedTier(current, subscription.tier, subscription.tierLabel)
							: current
					);
					clearCheckoutAttempt();
					return true;
				}
			}
			return false;
		},
		[refreshSession]
	);

	// Payment success alone is not entitlement. Confirm the exact attempt and its projected tier.
	const waitForTierActivation = useCallback(
		async (
			tierId: string,
			tierLabel: string,
			guard: OperationGuard,
			attemptId: string,
			accountId: string
		) => {
			const isCurrent = guard.isCurrent;
			if (!isCurrent()) return;
			setState((current) =>
				isCurrent()
					? withBusyStatus(
							withPaymentPending(current, tierLabel, attemptId, null),
							'activating',
							`Confirming your ${tierLabel} subscription...`
						)
					: current
			);
			const started = Date.now();
			while (isCurrent() && Date.now() - started < ACTIVATION_TIMEOUT_MS) {
				try {
					const status = await fetchCheckoutStatus(attemptId, accountId);
					if (await applyAttemptStatus(status, tierId, tierLabel, guard, accountId)) return;
				} catch {
					// The webhook may still be in flight; keep polling until the bound.
				}
				await new Promise((resolve) => setTimeout(resolve, ACTIVATION_POLL_MS));
			}
			if (!isCurrent()) return;
			captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'activation_pending', location });
			setState((current) =>
				isCurrent() ? withPaymentPending(current, tierLabel, attemptId, null) : current
			);
		},
		[applyAttemptStatus]
	);

	const recoverStoredAttempt = useCallback(
		async (guard: OperationGuard) => {
			const client = await initializePricingBilling();
			if (!guard.isCurrent()) return false;
			const accountId = accountIdFrom(client.auth?.getUser() ?? null);
			const attempt = readCheckoutAttempt(accountId);
			if (!attempt || !accountId) return false;
			const planLabel =
				catalogRef.current?.plans.find((plan) => plan.id === attempt.tierId)?.label ??
				attempt.tierId;
			await waitForTierActivation(attempt.tierId, planLabel, guard, attempt.attemptId, accountId);
			return true;
		},
		[waitForTierActivation]
	);

	const onCheckoutProgress = useCallback((progress: CheckoutProgress, guard: OperationGuard) => {
		const progressCurrent = guard.isCurrent;
		if (!progressCurrent()) return;
		setInterval(progress.interval);
		setCheckoutTierId(progress.tierId);
		if (progress.status === 'error') {
			const attempt = readCheckoutAttempt(guard.context.accountId);
			const tierLabel =
				catalogRef.current?.plans.find((plan) => plan.id === attempt?.tierId)?.label ??
				attempt?.tierId;
			setState((current) =>
				progressCurrent()
					? withError(
							attempt && tierLabel
								? withPaymentPending(current, tierLabel, attempt.attemptId, null)
								: current,
							progress.message
						)
					: current
			);
			captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'error', location });
			return;
		}
		if (!progressCurrent()) return;
		const status =
			progress.status === 'signing_in'
				? 'signing_in'
				: progress.status === 'redirecting'
					? 'redirecting'
					: 'starting_checkout';
		setState((current) =>
			progressCurrent() ? withBusyStatus(current, status, progress.message) : current
		);
		if (progress.status === 'redirecting') {
			captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'redirecting', location });
		}
	}, []);

	useEffect(() => {
		let active = true;
		const operations = getOperations();
		const mountGuard = operations.begin('mount');
		const isCurrent = () => active && mountGuard.isCurrent();
		const searchParams = new URLSearchParams(window.location.search);
		const checkout = searchParams.get('checkout');
		const returnTierId = searchParams.get('tier')?.trim() || null;
		const checkoutFromUrl = checkoutRequestFromSearch(window.location.search);
		if (checkoutFromUrl) {
			setInterval(checkoutFromUrl.interval);
			setCheckoutTierId(checkoutFromUrl.tierId);
		}

		void (async () => {
			try {
				let liveCatalog = initialCatalog;
				if (initialCatalog && !checkoutFromUrl) {
					void fetchPublicPricingCatalog()
						.then((next) => active && setCatalog(next))
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
					window.history.replaceState(
						window.history.state,
						'',
						pricingUrlWithoutCheckoutCommand(window.location.href)
					);
					const guard = operations.begin(session.accountId ?? 'signed-out');
					await runCheckout(checkoutFromUrl.tierId, checkoutFromUrl.interval, {
						guard,
						allowSignIn: checkout !== 'resume',
						emit: (progress) => onCheckoutProgress(progress, guard)
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
		};
	}, [initialCatalog, refreshSession, recoverStoredAttempt, onCheckoutProgress]);

	useEffect(() => {
		const onPageShow = (event: PageTransitionEvent) => {
			if (!event.persisted) return;
			const guard = getOperations().begin('restored');
			void (async () => {
				try {
					const session = await refreshSession(null, guard);
					if (session && guard.isCurrent()) await recoverStoredAttempt(guard);
				} catch (error) {
					setState((current) =>
						guard.isCurrent()
							? withError(
									current,
									error instanceof Error ? error.message : 'Could not refresh billing.'
								)
							: current
					);
				}
			})();
		};
		window.addEventListener('pageshow', onPageShow);
		return () => window.removeEventListener('pageshow', onPageShow);
	}, [refreshSession, recoverStoredAttempt]);

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
		if (!canStartCheckout(state)) {
			setState((current) =>
				withError(current, 'Another billing action is in progress. Try again in a moment.')
			);
			return;
		}
		if (!planIsAvailable(catalog, planId, planInterval)) {
			setState((current) => withError(current, 'This billing interval is not available.'));
			return;
		}
		setCheckoutTierId(planId);
		setState((current) =>
			withBusyStatus(current, 'starting_checkout', 'Preparing secure checkout…')
		);
		captureAnalyticsEvent(CHECKOUT_STARTED_EVENT, {
			interval: planInterval,
			location,
			plan: planId
		});
		const guard = getOperations().begin(accountRef.current ?? 'signed-out');
		await runCheckout(planId, planInterval, {
			guard,
			emit: (progress) => onCheckoutProgress(progress, guard)
		});
	}

	async function manageBilling() {
		setState((current) => withBusyStatus(current, 'managing_billing', 'Opening billing portal...'));
		captureAnalyticsEvent(CTA_CLICKED_EVENT, { cta: 'pricing_manage_billing', location });
		const guard = await beginAccountOperation();
		if (!guard) return;
		try {
			setState((current) =>
				guard.isCurrent()
					? withBusyStatus(current, 'managing_billing', 'Opening billing portal...')
					: current
			);
			const portalUrl = await openCustomerPortal(guard.context.accountId);
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
		setState((current) => withBusyStatus(current, 'activating', 'Checking payment status...'));
		const guard = await beginAccountOperation();
		if (!guard) return;
		try {
			if (!(await recoverStoredAttempt(guard))) {
				await refreshSession('Your account billing status has been refreshed.', guard);
			}
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

	// Resume only the account-owned, freshly checked attempt. Never create a replacement purchase.
	async function continueCheckout() {
		const attemptId = state.pendingAttemptId;
		if (!attemptId || !state.pendingCheckoutUrl) return;
		setState((current) =>
			withBusyStatus(current, 'starting_checkout', 'Preparing secure checkout…')
		);
		const guard = await beginAccountOperation();
		if (!guard) return;
		const account = guard.context.accountId;
		try {
			const status = await fetchCheckoutStatus(attemptId, account);
			guard.assertCurrent();
			const attempt = readCheckoutAttempt(account);
			if (attempt?.attemptId !== attemptId) {
				if (!(await recoverStoredAttempt(guard))) {
					await refreshSession('Your account billing status has been refreshed.', guard);
				}
				return;
			}
			const tierLabel =
				catalogRef.current?.plans.find((plan) => plan.id === attempt.tierId)?.label ??
				attempt.tierId;
			if (
				status.status !== 'awaiting_payment' ||
				!status.checkout_url ||
				status.checkout_url !== state.pendingCheckoutUrl
			) {
				if (!(await applyAttemptStatus(status, attempt.tierId, tierLabel, guard, account))) {
					await waitForTierActivation(attempt.tierId, tierLabel, guard, attemptId, account);
				}
				return;
			}
			setState((current) =>
				guard.isCurrent()
					? withBusyStatus(current, 'redirecting', 'Redirecting to secure checkout…')
					: current
			);
			guard.assertCurrent();
			window.location.assign(status.checkout_url);
		} catch (error) {
			setState((current) =>
				guard.isCurrent()
					? withError(
							current,
							error instanceof Error ? error.message : 'Could not resume the checkout.'
						)
					: current
			);
		}
	}

	async function signOut() {
		captureAnalyticsEvent(CTA_CLICKED_EVENT, { cta: 'pricing_sign_out', location });
		clearPendingPricingAction();
		const operations = getOperations();
		accountRef.current = null;
		setState((current) => ({ ...current, busy: false }));
		const probe = operations.begin('signed-out');
		try {
			await signOutOfPricing();
		} catch {
			if (!probe.isCurrent()) return;
			const client = await initializePricingBilling().catch(() => null);
			if (!probe.isCurrent()) return;
			accountRef.current = accountIdFrom(client?.auth?.getUser() ?? null);
			await refreshSession(null, probe).catch(() => null);
			if (!probe.isCurrent()) return;
			const attempt = readCheckoutAttempt(accountRef.current);
			const planLabel =
				catalogRef.current?.plans.find((plan) => plan.id === attempt?.tierId)?.label ??
				attempt?.tierId;
			setState((current) =>
				withError(
					attempt && planLabel
						? withPaymentPending(current, planLabel, attempt.attemptId, null)
						: current,
					'Could not sign out. Please try again.'
				)
			);
			return;
		}
		// A component unmount or account replacement during the network call must
		// not resurrect a signed-out view over the current UI.
		if (probe.isCurrent()) {
			clearCheckoutAttempt();
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
		if (state.status === 'managing_billing' && isCurrentTier) return 'Opening billing portal...';
		if (checkoutTierId === plan.id) {
			if (state.status === 'signing_in') return 'Redirecting to sign in...';
			if (state.status === 'starting_checkout') return 'Starting checkout...';
			if (state.status === 'redirecting') return 'Redirecting to checkout...';
			if (state.status === 'activating') return `Confirming ${plan.title}...`;
		}
		if (isCurrentTier && showsManageBilling(state)) return 'Manage billing';
		if (isCurrentTier) return 'Current plan';
		if (!planIsAvailable(catalog, plan.id, interval)) return 'Unavailable';
		return plan.buttonText;
	}

	const account = (
		<PricingAccount
			state={state}
			onManageBilling={() => void manageBilling()}
			onCheckStatus={() => void checkPaymentStatus()}
			onContinueCheckout={() => void continueCheckout()}
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
						if (state.busy) return true;
						if (plan.id === 'free') return false;
						if (plan.id === state.tier) return !showsManageBilling(state);
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
