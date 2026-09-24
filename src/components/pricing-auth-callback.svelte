<script lang="ts">
	import { initializePricingBilling } from '@/lib/pricing/billing-client';
	import { readPendingPricingAction } from '@/lib/pricing/pending';
	import { marketingSectionBodyClass } from '@/styles/marketing';

	let message = $state('Finishing sign-in…');

	$effect(() => {
		void (async () => {
			try {
				const params = new URLSearchParams(window.location.search);
				const callbackError = params.get('error_description') ?? params.get('error');
				const client = await initializePricingBilling({
					// AuthKit invokes this before createClient resolves. Wait for the
					// initialized client below so we can verify that a user exists.
					onRedirectCallback: () => {}
				});
				if (client.user) {
					const pending = readPendingPricingAction();
					if (!pending) {
						window.location.replace('/pricing');
						return;
					}
					const query = new URLSearchParams({
						checkout: 'start',
						tier: pending.tierId,
						interval: pending.interval
					});
					window.location.replace(`/pricing?${query}`);
					return;
				}
				message =
					callbackError ??
					'Sign-in could not be completed. Return to pricing and try again. Your checkout choice was saved.';
			} catch (error) {
				message =
					error instanceof Error
						? error.message
						: 'Sign-in could not be completed. Return to pricing and try again.';
			}
		})();
	});
</script>

<div class="mx-auto max-w-lg px-4 pt-32 text-center sm:px-6">
	<p class="font-mono text-xs font-medium tracking-[0.14em] text-accent-strong uppercase">
		Pricing
	</p>
	<h1 class="mt-3 font-brand text-3xl font-semibold tracking-tight text-foreground">
		Completing sign-in
	</h1>
	<p class={`${marketingSectionBodyClass} mt-4`} role="status" aria-live="polite">
		{message}
	</p>
	<a
		href="/pricing"
		class="mt-8 inline-flex font-sans text-sm font-medium text-accent-strong underline decoration-accent-strong/30 underline-offset-4"
	>
		Back to pricing
	</a>
</div>
