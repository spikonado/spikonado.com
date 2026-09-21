<script lang="ts">
	import { captureAnalyticsEvent } from '@/lib/analytics/bootstrap';
	import {
		CHECKOUT_STARTED_EVENT,
		CHECKOUT_STATUS_EVENT,
		CTA_CLICKED_EVENT,
		INTERVAL_SELECTED_EVENT,
		type AnalyticsLocation
	} from '@/lib/analytics/events';
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
		isBillingInterval,
		pricingFaqs,
		proPriceLabel,
		type BillingInterval,
		type PricingPlan
	} from '@/lib/pricing/catalog';
	import {
		createInitialPricingState,
		showsManageBilling,
		withActivatedPro,
		withActivationTimeout,
		withBusyStatus,
		withError,
		withReadySession,
		type PricingUiState
	} from '@/lib/pricing/checkout-state';
	import {
		bootCheckoutFromUrl,
		checkoutIntervalFromSearch,
		PRICING_CHECKOUT_PROGRESS_EVENT,
		runProCheckout,
		type CheckoutProgress
	} from '@/lib/pricing/start-checkout';
	import {
		marketingButtonPrimaryClass,
		marketingButtonSecondaryClass,
		marketingPanelClass,
		marketingTextLinkClass
	} from '@/styles/marketing';
	import { cn } from '@/utils';
	import { onMount, untrack } from 'svelte';

	interface Props {
		initialCatalog?: PublicPricingCatalog | null;
	}

	let { initialCatalog = null }: Props = $props();

	const location: AnalyticsLocation = 'pricing_page';
	const ACTIVATION_TIMEOUT_MS = 30_000;
	const ACTIVATION_POLL_MS = 2_000;
	const BILLING_INTERVAL_INPUT_NAME = 'sprocket-billing-interval';

	let state: PricingUiState = $state(createInitialPricingState());
	let billingInterval: BillingInterval = $state('monthly');
	let resumeHandled = $state(false);
	// Seed once from SSR; live refresh owns these afterward.
	let catalog: PublicPricingCatalog | null = $state(untrack(() => initialCatalog));
	let pricingPlans: PricingPlan[] = $state(
		untrack(() => (initialCatalog ? buildPricingPlans(initialCatalog) : []))
	);

	function trackCta(cta: string, extra?: Record<string, string>) {
		captureAnalyticsEvent(CTA_CLICKED_EVENT, { cta, location, ...extra });
	}

	function selectedBillingInterval(): BillingInterval {
		if (typeof document === 'undefined') return billingInterval;

		const bridged = document
			.querySelector<HTMLElement>('astro-island[component-url*="pricing-plans.svelte"]')
			?.getAttribute('data-pricing-billing-interval');
		if (isBillingInterval(bridged)) return bridged;

		const checked = document.querySelector<HTMLInputElement>(
			`input[name="${BILLING_INTERVAL_INPUT_NAME}"]:checked`
		)?.value;
		return isBillingInterval(checked) ? checked : billingInterval;
	}

	function applyBillingInterval(next: BillingInterval) {
		billingInterval = next;
		if (typeof document === 'undefined') return;

		const input = document.querySelector<HTMLInputElement>(
			`input[name="${BILLING_INTERVAL_INPUT_NAME}"][value="${next}"]`
		);
		if (input) input.checked = true;
	}

	function selectBillingInterval(next: BillingInterval) {
		applyBillingInterval(next);
		captureAnalyticsEvent(INTERVAL_SELECTED_EVENT, { interval: next, location });
	}

	async function refreshSession(message: string | null = null) {
		const client = await initializePricingBilling();
		let tier: SubscriptionTier = 'free';
		if (client.user) {
			try {
				tier = await fetchMySubscription();
			} catch {
				tier = 'free';
			}
		}
		const userLabel = client.user?.email ?? client.user?.firstName ?? null;
		state = withReadySession(state, {
			authenticated: Boolean(client.user),
			tier,
			userLabel,
			message
		});
	}

	async function waitForProActivation() {
		state = withBusyStatus(state, 'activating', 'Confirming your Pro subscription…');
		const started = Date.now();
		while (Date.now() - started < ACTIVATION_TIMEOUT_MS) {
			try {
				const tier = await fetchMySubscription();
				if (tier === 'pro' || tier === 'admin') {
					captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, {
						status: 'activated',
						location
					});
					state = withActivatedPro(state);
					return;
				}
			} catch {
				// Keep polling until timeout.
			}
			await new Promise((resolve) => setTimeout(resolve, ACTIVATION_POLL_MS));
		}
		captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'activation_pending', location });
		state = withActivationTimeout(state);
	}

	function applyCheckoutProgress(progress: CheckoutProgress) {
		applyBillingInterval(progress.interval);
		if (progress.status === 'error') {
			state = withError(state, progress.message);
			captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'error', location });
			return;
		}
		if (progress.status === 'signing_in') {
			state = withBusyStatus(state, 'signing_in', progress.message);
			return;
		}
		if (progress.status === 'checkout_open') {
			state = withBusyStatus(state, 'checkout_open', progress.message);
			captureAnalyticsEvent(CHECKOUT_STATUS_EVENT, { status: 'overlay_opened', location });
			return;
		}
		state = withBusyStatus(state, 'starting_checkout', progress.message);
	}

	async function startCheckout(interval: BillingInterval) {
		if (state.tier === 'pro' || state.tier === 'admin') {
			state = withError(state, 'Pro is already active on this account.');
			return;
		}
		captureAnalyticsEvent(CHECKOUT_STARTED_EVENT, { interval, location, plan: 'pro' });
		document.getElementById('pricing-checkout-boot-status')?.classList.remove('hidden');
		await runProCheckout(interval);
	}

	async function manageBilling() {
		trackCta('pricing_manage_billing');
		try {
			state = withBusyStatus(state, 'managing_billing', 'Opening billing portal…');
			const portalUrl = await openCustomerPortal();
			window.location.assign(portalUrl);
		} catch (error) {
			state = withError(
				state,
				error instanceof Error ? error.message : 'Could not open the billing portal.'
			);
		}
	}

	async function handleSignOut() {
		trackCta('pricing_sign_out');
		await signOutOfPricing();
		state = withReadySession(state, {
			authenticated: false,
			tier: 'free',
			userLabel: null,
			message: null
		});
	}

	async function loadCatalog() {
		const next = await fetchPublicPricingCatalog();
		catalog = next;
		pricingPlans = buildPricingPlans(next);
	}

	onMount(() => {
		if (resumeHandled) return;
		resumeHandled = true;
		document
			.querySelector<HTMLElement>('astro-island[component-url*="pricing-plans.svelte"]')
			?.setAttribute('data-pricing-hydrated', '');

		const onCheckoutProgress = (event: Event) => {
			if (!(event instanceof CustomEvent)) return;
			applyCheckoutProgress(event.detail as CheckoutProgress);
		};
		document.addEventListener(PRICING_CHECKOUT_PROGRESS_EVENT, onCheckoutProgress);

		const fromUrl = checkoutIntervalFromSearch();
		applyBillingInterval(fromUrl ?? selectedBillingInterval());
		void bootCheckoutFromUrl();

		void (async () => {
			try {
				if (!catalog) {
					await loadCatalog();
				} else {
					void loadCatalog().catch(() => {
						/* Keep SSR/bootstrap catalog if the live refresh fails. */
					});
				}
				const params = new URLSearchParams(window.location.search);
				const checkout = params.get('checkout');
				if (checkout === 'start') {
					await refreshSession();
					return;
				}
				await refreshSession(
					checkout === 'cancel' ? 'Checkout was cancelled. You can try again anytime.' : null
				);
				if (checkout === 'return') {
					await waitForProActivation();
					window.history.replaceState({}, '', '/pricing');
					return;
				}
				if (checkout === 'cancel') {
					window.history.replaceState({}, '', '/pricing');
				}
			} catch (error) {
				state = withError(
					state,
					error instanceof Error ? error.message : 'Could not load pricing.'
				);
			}
		})();

		return () => {
			document.removeEventListener(PRICING_CHECKOUT_PROGRESS_EVENT, onCheckoutProgress);
		};
	});

	const monthlyProPrice = $derived(proPriceLabel('monthly', catalog?.proPrices ?? null));
	const annualProPrice = $derived(proPriceLabel('annual', catalog?.proPrices ?? null));
	const checkoutInFlight = $derived(
		state.status === 'signing_in' ||
			state.status === 'starting_checkout' ||
			state.status === 'checkout_open' ||
			state.status === 'managing_billing' ||
			state.status === 'activating'
	);
	const proCheckoutHref = $derived(`/pricing?checkout=start&interval=${billingInterval}`);
	const proCtaLabel = $derived(
		state.status === 'signing_in'
			? 'Redirecting to sign in…'
			: state.status === 'starting_checkout'
				? 'Starting checkout…'
				: state.status === 'checkout_open'
					? 'Checkout opened'
					: state.status === 'activating'
						? 'Confirming Pro…'
						: 'Get Pro'
	);
</script>

<section class="pricing-plans" aria-labelledby="pricing-heading" data-ph-section="pricing_plans">
	<div class="flex flex-col items-center text-center">
		<h1
			id="pricing-heading"
			class="font-brand text-5xl font-semibold tracking-tight text-foreground sm:text-6xl"
		>
			Pricing
		</h1>

		<div
			class="mt-8 inline-flex rounded-full border border-border/70 bg-surface p-1"
			role="radiogroup"
			aria-label="Billing interval"
		>
			<label class="cursor-pointer">
				<input
					class="peer sr-only"
					type="radio"
					name={BILLING_INTERVAL_INPUT_NAME}
					value="monthly"
					data-pricing-billing-interval
					checked
					onchange={() => selectBillingInterval('monthly')}
				/>
				<span
					class="block rounded-full px-5 py-2 font-sans text-sm font-medium text-muted-foreground transition-colors peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-focus-visible:outline-none"
				>
					Monthly
				</span>
			</label>
			<label class="cursor-pointer">
				<input
					class="peer sr-only"
					type="radio"
					name={BILLING_INTERVAL_INPUT_NAME}
					value="annual"
					data-pricing-billing-interval
					onchange={() => selectBillingInterval('annual')}
				/>
				<span
					class="block rounded-full px-5 py-2 font-sans text-sm font-medium text-muted-foreground transition-colors peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-focus-visible:outline-none"
				>
					Yearly
				</span>
			</label>
		</div>
	</div>

	{#if state.message}
		<p
			class={cn(
				'mx-auto mt-8 max-w-2xl rounded-xl border px-4 py-3 text-left font-sans text-sm',
				state.status === 'error'
					? 'border-red-300/70 bg-red-50 text-red-900'
					: 'border-accent/25 bg-accent-soft text-foreground'
			)}
			role={state.status === 'error' ? 'alert' : 'status'}
			aria-live="polite"
		>
			{state.message}
		</p>
	{/if}

	{#if state.authenticated && state.userLabel}
		<div
			class="mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-center gap-3 font-sans text-sm text-muted-foreground"
		>
			<p>
				Signed in as <span class="text-foreground">{state.userLabel}</span>
				{#if state.tier !== 'free'}
					· Current plan: <span class="text-foreground capitalize">{state.tier}</span>
				{/if}
			</p>
			<button type="button" class={marketingTextLinkClass} onclick={handleSignOut}>
				Sign out
			</button>
		</div>
	{/if}

	{#if pricingPlans.length === 0}
		<p class="mt-16 text-center font-sans text-sm text-muted-foreground" role="status">
			Loading plan details…
		</p>
	{/if}

	<div class="mt-12 grid gap-6 md:grid-cols-3">
		{#each pricingPlans as plan (plan.id)}
			<article
				class={cn(
					marketingPanelClass,
					'flex flex-col p-6 sm:p-7',
					plan.highlighted && 'border-accent/40 ring-2 ring-accent/30'
				)}
			>
				<h2 class="font-brand text-xl font-semibold text-foreground">{plan.name}</h2>

				<div class="mt-3">
					{#if plan.id === 'free'}
						<p class="font-brand text-3xl font-semibold tracking-tight text-foreground">Free</p>
					{:else if plan.id === 'pro'}
						<div class="billing-price-monthly">
							<p class="font-brand text-3xl font-semibold tracking-tight text-foreground">
								{monthlyProPrice?.cardPrice ?? 'Pro'}
							</p>
							{#if monthlyProPrice}
								<p class="mt-1 font-sans text-sm text-muted-foreground">
									{monthlyProPrice.billed}
								</p>
							{/if}
						</div>
						<div class="billing-price-annual">
							<p class="font-brand text-3xl font-semibold tracking-tight text-foreground">
								{#if annualProPrice?.compareAt}
									<s class="mr-2 text-2xl font-medium text-muted-foreground"
										>{annualProPrice.compareAt}</s
									>
								{/if}
								{annualProPrice?.cardPrice ?? 'Pro'}
							</p>
							{#if annualProPrice}
								<p class="mt-1 font-sans text-sm text-muted-foreground">
									{annualProPrice.billed}
								</p>
							{/if}
						</div>
					{:else}
						<p class="font-brand text-3xl font-semibold tracking-tight text-foreground">Custom</p>
					{/if}
				</div>

				<p class="mt-8 font-sans text-sm text-muted-foreground">{plan.includesLabel}</p>

				<ul class="mt-3 flex-1 space-y-2.5">
					{#each plan.features as feature (feature)}
						<li class="flex gap-2.5 font-sans text-sm leading-snug text-foreground">
							<span
								class="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-action-soft text-xs text-foreground"
								aria-hidden="true"
							>
								✓
							</span>
							<span>{feature}</span>
						</li>
					{/each}
				</ul>

				<div class="mt-8">
					{#if plan.id === 'free'}
						<a
							href="/#sprocket"
							class={cn(marketingButtonSecondaryClass, 'w-full')}
							data-ph-capture={CTA_CLICKED_EVENT}
							data-ph-cta="pricing_start_free"
							data-ph-location={location}
						>
							Start free
						</a>
					{:else if plan.id === 'pro'}
						{#if showsManageBilling(state)}
							<button
								type="button"
								class={cn(marketingButtonPrimaryClass, 'w-full')}
								disabled={checkoutInFlight}
								onclick={manageBilling}
							>
								Manage billing
							</button>
						{:else}
							<a
								href={proCheckoutHref}
								class={cn(marketingButtonPrimaryClass, 'w-full')}
								data-pricing-checkout
								aria-disabled={checkoutInFlight || state.tier === 'pro' || state.tier === 'admin'}
								aria-busy={checkoutInFlight}
								onclick={(event) => {
									event.preventDefault();
									const interval = selectedBillingInterval();
									if (checkoutInFlight || state.tier === 'pro' || state.tier === 'admin') {
										return;
									}
									trackCta('pricing_upgrade_pro', { interval });
									void startCheckout(interval);
								}}
							>
								{proCtaLabel}
							</a>
						{/if}
					{:else}
						<a
							href={ENTERPRISE_MAILTO}
							class={cn(marketingButtonSecondaryClass, 'w-full')}
							data-ph-capture={CTA_CLICKED_EVENT}
							data-ph-cta="pricing_contact_sales"
							data-ph-location={location}
						>
							Contact Sales
						</a>
					{/if}
				</div>
			</article>
		{/each}
	</div>
</section>

<section class="mt-20" aria-labelledby="pricing-faq-heading" data-ph-section="pricing_faq">
	<h2 id="pricing-faq-heading" class="font-brand text-2xl font-semibold text-foreground">FAQ</h2>
	<div class="mt-6 space-y-4">
		{#each pricingFaqs as faq (faq.question)}
			<details class={cn(marketingPanelClass, 'group p-5')}>
				<summary
					class="cursor-pointer list-none font-brand text-lg font-semibold text-foreground marker:content-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
				>
					<span class="flex items-center justify-between gap-3">
						{faq.question}
						<span
							class="text-muted-foreground transition-transform group-open:rotate-45"
							aria-hidden="true">+</span
						>
					</span>
				</summary>
				<p class="mt-3 font-sans text-base leading-relaxed text-muted-foreground">{faq.answer}</p>
			</details>
		{/each}
	</div>
</section>

<style>
	.billing-price-annual {
		display: none;
	}

	.pricing-plans:has(input[value='annual']:checked) .billing-price-monthly {
		display: none;
	}

	.pricing-plans:has(input[value='annual']:checked) .billing-price-annual {
		display: block;
	}
</style>
