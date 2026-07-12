<script lang="ts">
	import { marketingSectionBodyClass } from '@/styles/marketing';
	import { cn } from '@/utils';

	const SUBSCRIBE_PATH = '/api/build-log/subscribe';

	type FormStatus = 'idle' | 'submitting' | 'success' | 'invalid' | 'error';

	let email = $state('');
	let company = $state('');
	let status = $state<FormStatus>('idle');
	let statusMessage = $state('');

	const isBusy = $derived(status === 'submitting');
	const isLocked = $derived(status === 'submitting' || status === 'success');

	const fieldClass = cn(
		'w-full min-w-0 flex-1 border border-border bg-background px-3 py-2.5',
		'font-sans text-base text-foreground outline-none transition-colors',
		'placeholder:text-muted-foreground',
		'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
		'disabled:cursor-not-allowed disabled:opacity-60',
		'motion-reduce:transition-none'
	);

	const submitClass = cn(
		'shrink-0 border border-foreground bg-foreground px-4 py-2.5',
		'font-sans text-base text-background transition-opacity',
		'hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
		'disabled:cursor-not-allowed disabled:opacity-50',
		'motion-reduce:transition-none'
	);

	function resetStatusOnEdit() {
		if (status === 'invalid' || status === 'error' || status === 'success') {
			status = 'idle';
			statusMessage = '';
		}
	}

	async function onSubmit(event: SubmitEvent) {
		event.preventDefault();

		if (isLocked) {
			return;
		}

		const trimmedEmail = email.trim();

		status = 'submitting';
		statusMessage = 'Submitting…';
		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), 10_000);

		try {
			const response = await fetch(SUBSCRIBE_PATH, {
				method: 'POST',
				signal: controller.signal,
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json'
				},
				body: JSON.stringify({
					email: trimmedEmail,
					company
				})
			});

			if (response.ok) {
				email = '';
				company = '';
				status = 'success';
				statusMessage = "You're subscribed. Check your inbox for the welcome email.";
				return;
			}

			if (response.status === 400 || response.status === 422) {
				status = 'invalid';
				statusMessage = 'Please enter a valid email address.';
				return;
			}

			status = 'error';
			statusMessage = 'Something went wrong. Please try again in a moment.';
		} catch {
			status = 'error';
			statusMessage = 'Something went wrong. Please try again in a moment.';
		} finally {
			window.clearTimeout(timeout);
		}
	}
</script>

<div class="flex w-full flex-col items-center gap-4 text-center md:items-start md:text-left">
	<p class={marketingSectionBodyClass}>
		Subscribe to our build log to get notified when we start launching our first products.
		Unsubscribe anytime.
	</p>

	<form class="relative flex w-full max-w-md flex-col gap-3" aria-busy={isBusy} onsubmit={onSubmit}>
		<div
			class="pointer-events-none absolute left-[-10000px] h-0 w-0 overflow-hidden opacity-0"
			aria-hidden="true"
		>
			<label for="build-log-company">Company</label>
			<input
				id="build-log-company"
				name="company"
				type="text"
				tabindex="-1"
				autocomplete="one-time-code"
				bind:value={company}
			/>
		</div>

		<div class="flex w-full flex-col gap-2">
			<label for="build-log-email" class="font-sans text-sm font-medium text-foreground">
				Email
			</label>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-stretch">
				<input
					id="build-log-email"
					name="email"
					type="email"
					inputmode="email"
					autocomplete="email"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
					maxlength="254"
					required
					placeholder="you@company.com"
					class={fieldClass}
					bind:value={email}
					disabled={isBusy}
					aria-invalid={status === 'invalid' ? 'true' : undefined}
					aria-describedby="build-log-status"
					oninput={resetStatusOnEdit}
				/>
				<button type="submit" class={submitClass} disabled={isLocked}>
					{isBusy ? 'Submitting…' : 'Subscribe'}
				</button>
			</div>
		</div>

		<p
			id="build-log-status"
			class={cn(
				'min-h-5 font-sans text-sm leading-snug',
				status === 'success' && 'text-foreground',
				(status === 'invalid' || status === 'error') && 'text-blue-600',
				(status === 'idle' || status === 'submitting') && 'text-muted-foreground'
			)}
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			{statusMessage}
		</p>
	</form>
</div>
